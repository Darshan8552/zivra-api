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

@WebSocketGateway({
  namespace: '/notifications',
  cors: {
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
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

  // Best practice: Initialize Socket.IO Redis Adapter here or in main.ts for multi-pod scaling
  afterInit(server: Server) {
    this.logger.log('WebSocket Gateway initialized');
    // TODO: Inject Upstash Redis Adapter here later for horizontal scaling
  }

  async handleConnection(socket: Socket) {
    try {
      const token = this.extractTokens(socket);
      if (!token) throw new Error('Missing token');
      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      });

      const isBlacklisted = await this.redisService.exists(`bl:${payload.jti}`);
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

    return undefined;
  }

  emitToUser(userId: string, event: string, payload: unknown): void {
    this.server.to(`user:${userId}`).emit(event, payload);
  }

  @OnEvent('notification.created')
  handleNotificationCreated(notification: any) {
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
