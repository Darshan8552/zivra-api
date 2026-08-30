import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtPayload } from 'src/auth/strategies/jwt.strategy';
import { RedisService } from 'src/redis/redis.service';
import { UsersService } from 'src/users/users.service';
import { RedisKeys } from 'src/common/utils/redis-keys';
import { cookieExtractor } from 'src/common/utils/jwt-extractor.util';

@WebSocketGateway({
  namespace: '/notifications',
  cors: {
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
    credentials: true,
  },
})
export class NotificationsGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly usersService: UsersService,
  ) {}

  afterInit(server: Server) {
    this.logger.log('WebSocket Gateway initialized');

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
          'UPSTASH_REDIS_URL not set — skipping Socket.IO Redis adapter (single-instance mode)',
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
        'Socket.IO Redis adapter initialized — horizontal scaling enabled',
      );
    } catch (err) {
      this.logger.warn(
        `Socket.IO Redis adapter not configured — running in single-instance mode. ` +
          `To enable horizontal scaling: npm i @socket.io/redis-adapter. Reason: ${(err as Error).message}`,
      );
    }
  }

  async handleConnection(socket: Socket) {
    try {
      const token = this.extractTokens(socket);
      if (!token) throw new Error('Missing token');
      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      });

      const isBlacklisted = await this.redisService.exists(
        RedisKeys.auth.blacklist(payload.jti),
      );
      if (isBlacklisted) {
        throw new Error('Token revoked');
      }

      await socket.join(`user:${payload.sub}`);
      this.logger.log(`User ${payload.sub} connected.`);
    } catch (error) {
      this.logger.warn(`Rejected socket: ${(error as Error).message}`);
      socket.emit('unauthorized', { message: (error as Error).message });
      socket.disconnect();
    }
  }

  private extractTokens(socket: Socket): string | undefined {
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

  emitToUser(userId: string, event: string, payload: unknown): void {
    this.server.to(`user:${userId}`).emit(event, payload);
  }

  @OnEvent('notification.created')
  handleNotificationCreated(
    notification: { userId: string } & Record<string, unknown>,
  ) {
    this.emitToUser(notification.userId, 'notification', notification);
  }

  @OnEvent('notification.read')
  handleNotificationRead(payload: { userId: string; notificationId: string }) {
    this.emitToUser(
      payload.userId,
      'notification:read',
      payload.notificationId,
    );
  }

  @OnEvent('notification.all_read')
  handleAllNotificationsRead(payload: { userId: string }) {
    this.emitToUser(payload.userId, 'notification:all_read', true);
  }
}
