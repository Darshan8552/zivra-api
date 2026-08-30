import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtPayload } from 'src/auth/strategies/jwt.strategy';
import { RedisService } from 'src/redis/redis.service';
import { RedisKeys } from 'src/common/utils/redis-keys';
import { cookieExtractor } from 'src/common/utils/jwt-extractor.util';
import { PrismaService } from 'src/prisma/prisma.service';

@WebSocketGateway({
  namespace: '/chat',
  cors: {
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatGateway.name);
  private readonly typingThrottle = new Map<string, number>();
  private readonly presenceCounts = new Map<string, number>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  afterInit(server: Server) {
    this.logger.log('Chat WebSocket Gateway initialized');

    try {
      const { createAdapter } = require('@socket.io/redis-adapter') as {
        createAdapter: (
          pub: unknown,
          sub: unknown,
        ) => ReturnType<Server['adapter']>;
      };

      const redisUrl = this.configService.get<string>('UPSTASH_REDIS_URL');
      if (!redisUrl) {
        this.logger.warn(
          'UPSTASH_REDIS_URL not set — skipping Socket.IO Redis adapter for /chat (single-instance mode)',
        );
        return;
      }

      let pubClient: unknown;
      let subClient: unknown;
      try {
        const shared = this.redisService.getClient();
        pubClient = shared.duplicate();
        subClient = shared.duplicate();
      } catch {
        const ioredisMod = require('ioredis') as { default?: unknown } & Record<
          string,
          unknown
        >;
        const RedisCtor = (ioredisMod.default ?? ioredisMod) as unknown as new (
          url: string,
          opts: unknown,
        ) => unknown;
        const opts = {
          tls: redisUrl.startsWith('rediss://') ? {} : undefined,
          maxRetriesPerRequest: 3 as const,
        };
        pubClient = new RedisCtor(redisUrl, opts);
        subClient = new RedisCtor(redisUrl, opts);
      }

      server.adapter(createAdapter(pubClient, subClient) as never);
      this.logger.log(
        'Socket.IO Redis adapter initialized for /chat — horizontal scaling enabled',
      );
    } catch (err) {
      this.logger.warn(
        `Socket.IO Redis adapter not configured for /chat — single-instance mode. Reason: ${(err as Error).message}`,
      );
    }
  }

  async handleConnection(socket: Socket) {
    try {
      const token = this.extractToken(socket);
      if (!token) throw new Error('Missing token');
      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      });

      const isBlacklisted = await this.redisService.exists(
        RedisKeys.auth.blacklist(payload.jti),
      );
      if (isBlacklisted) throw new Error('Token revoked');

      const userId = payload.sub;
      (socket.data as { userId?: string }).userId = userId;

      await socket.join(`user:${userId}`);

      // Join all conversation rooms for this user
      const participants = await this.prisma.conversationParticipant.findMany({
        where: { userId, leftAt: null },
        select: { conversationId: true },
      });

      for (const p of participants) {
        await socket.join(`conversation:${p.conversationId}`);
      }

      this.logger.log(
        `User ${userId} connected to /chat, joined ${participants.length} rooms`,
      );

      const count = (this.presenceCounts.get(userId) ?? 0) + 1;
      this.presenceCounts.set(userId, count);
      if (count === 1) {
        await this.broadcastPresence(userId, true);
      }
      // Send current presence for all participants of user's conversations
      await this.sendPresenceSnapshot(socket, userId);
    } catch (error) {
      this.logger.warn(`Rejected /chat socket: ${(error as Error).message}`);
      socket.emit('unauthorized', { message: (error as Error).message });
      socket.disconnect();
    }
  }

  async handleDisconnect(socket: Socket) {
    const userId = (socket.data as { userId?: string }).userId;
    if (userId) {
      const prev = this.presenceCounts.get(userId) ?? 1;
      const count = prev - 1;
      if (count <= 0) {
        this.presenceCounts.delete(userId);
        await this.broadcastPresence(userId, false);
      } else {
        this.presenceCounts.set(userId, count);
      }
      this.logger.log(
        `User ${userId} disconnected from /chat (${count} remaining)`,
      );
    }
  }

  private async broadcastPresence(userId: string, online: boolean) {
    try {
      const participants = await this.prisma.conversationParticipant.findMany({
        where: { userId, leftAt: null },
        select: { conversationId: true },
      });
      for (const p of participants) {
        this.server
          .to(`conversation:${p.conversationId}`)
          .emit('presence:update', {
            userId,
            online,
          });
      }
      // Also emit globally for inbox that may not be in room yet
      this.server.emit('presence:update', { userId, online });
    } catch {
      // ignore broadcast errors
    }
  }

  private async sendPresenceSnapshot(socket: Socket, userId: string) {
    try {
      const participants = await this.prisma.conversationParticipant.findMany({
        where: { userId, leftAt: null },
        select: { conversationId: true },
      });
      const conversationIds = participants.map((p) => p.conversationId);
      if (conversationIds.length === 0) return;
      const others = await this.prisma.conversationParticipant.findMany({
        where: {
          conversationId: { in: conversationIds },
          userId: { not: userId },
          leftAt: null,
        },
        select: { userId: true },
      });
      const uniqueUserIds = [...new Set(others.map((o) => o.userId))];
      for (const uid of uniqueUserIds) {
        const online = this.presenceCounts.has(uid);
        socket.emit('presence:update', { userId: uid, online });
      }
    } catch {
      // ignore
    }
  }

  private extractToken(socket: Socket): string | undefined {
    const authToken = socket.handshake.auth?.token as string | undefined;
    if (authToken) return authToken;

    const header = socket.handshake.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);

    const cookieHeader = socket.handshake.headers.cookie;
    if (cookieHeader) {
      const cookies: Record<string, string> = {};
      for (const part of cookieHeader.split(';')) {
        const [rawKey, ...rest] = part.trim().split('=');
        if (!rawKey || rest.length === 0) continue;
        cookies[rawKey] = decodeURIComponent(rest.join('='));
      }
      const mockReq = { cookies } as unknown as Parameters<
        ReturnType<typeof cookieExtractor>
      >[0];
      const fromCookie = cookieExtractor('access_token')(mockReq);
      if (fromCookie) return fromCookie;
    }
    return undefined;
  }

  // Room emits
  emitToConversation(conversationId: string, event: string, payload: unknown) {
    this.server.to(`conversation:${conversationId}`).emit(event, payload);
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    this.server.to(`user:${userId}`).emit(event, payload);
  }

  @OnEvent('message.created')
  handleMessageCreated(payload: {
    conversationId: string;
    message: Record<string, unknown>;
  }) {
    this.emitToConversation(
      payload.conversationId,
      'message:new',
      payload.message,
    );
    // Also emit conversation update for inbox preview/unread
    this.emitToConversation(payload.conversationId, 'conversation:updated', {
      conversationId: payload.conversationId,
      lastMessage: payload.message,
    });
  }

  @OnEvent('message.deleted')
  handleMessageDeleted(payload: { conversationId: string; messageId: string }) {
    this.emitToConversation(
      payload.conversationId,
      'message:deleted',
      payload.messageId,
    );
  }

  @SubscribeMessage('chat:typing')
  async handleTyping(
    @MessageBody() data: { conversationId?: string },
    @ConnectedSocket() socket: Socket,
  ) {
    const userId = (socket.data as { userId?: string }).userId;
    const conversationId = data?.conversationId;
    if (!userId || !conversationId) return;

    const key = `${userId}:${conversationId}`;
    const now = Date.now();
    const last = this.typingThrottle.get(key) ?? 0;
    if (now - last < 500) return;
    this.typingThrottle.set(key, now);

    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { userId: true },
    });
    if (!participant) return;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, username: true },
    });

    socket.to(`conversation:${conversationId}`).emit('typing:start', {
      conversationId,
      userId,
      name: user?.name ?? 'Someone',
      username: user?.username ?? '',
    });
  }

  @SubscribeMessage('chat:stopTyping')
  async handleStopTyping(
    @MessageBody() data: { conversationId?: string },
    @ConnectedSocket() socket: Socket,
  ) {
    const userId = (socket.data as { userId?: string }).userId;
    const conversationId = data?.conversationId;
    if (!userId || !conversationId) return;

    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { userId: true },
    });
    if (!participant) return;

    socket.to(`conversation:${conversationId}`).emit('typing:stop', {
      conversationId,
      userId,
    });
  }

  @OnEvent('conversation.read')
  handleConversationRead(payload: {
    conversationId: string;
    userId: string;
    readAt: Date;
  }) {
    this.emitToConversation(payload.conversationId, 'conversation:read', {
      conversationId: payload.conversationId,
      userId: payload.userId,
      readAt: payload.readAt,
    });
  }

  @SubscribeMessage('message:read')
  async handleMessageRead(
    @MessageBody() data: { conversationId?: string },
    @ConnectedSocket() socket: Socket,
  ) {
    const userId = (socket.data as { userId?: string }).userId;
    const conversationId = data?.conversationId;
    if (!userId || !conversationId) return;

    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { userId: true },
    });
    if (!participant) return;

    const updated = await this.prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { lastReadAt: new Date() },
    });

    this.emitToConversation(conversationId, 'conversation:read', {
      conversationId,
      userId,
      readAt: updated.lastReadAt,
    });
  }
}
