import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SafeUser } from '../common/types/safe-user.types';
import { Tokens } from '../common/interfaces/tokens.interface';
import * as bcrypt from 'bcryptjs';
import { JwtPayload } from 'src/auth/strategies/jwt.strategy';
import { RedisService } from 'src/redis/redis.service';
import { randomUUID } from 'node:crypto';
import { RedisKeys } from 'src/common/utils/redis-keys';

export interface RefreshPayload extends JwtPayload {
  sessionId: string;
}

export interface ResetPasswordPayload {
  sub: string;
  email: string;
}

@Injectable()
export class TokensService {
  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly jwtService: JwtService,
  ) {}

  async generateTokens(user: SafeUser, sessionId: string): Promise<Tokens> {
    const jti = randomUUID();
    const [accessToken, refreshToken] = await Promise.all([
      await this.jwtService.signAsync(
        {
          sub: user.id,
          email: user.email,
          jti,
        },
        {
          secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
          expiresIn: (this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') ??
            '15m') as never,
        },
      ),
      await this.jwtService.signAsync(
        {
          sub: user.id,
          email: user.email,
          sessionId,
        },
        {
          secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
          expiresIn: (this.configService.get<string>(
            'JWT_REFRESH_EXPIRES_IN',
          ) ?? '7d') as never,
        },
      ),
    ]);

    return { accessToken, refreshToken };
  }

  async blacklistToken(token: string): Promise<void> {
    try {
      const payload = await this.jwtService.verifyAsync<
        JwtPayload & { exp: number }
      >(token, { secret: this.configService.get<string>('JWT_ACCESS_SECRET') });

      const now = Math.floor(Date.now() / 1000);
      const ttl = payload.exp - now;

      if (ttl > 0 && payload.jti) {
        await this.redisService.setEx(
          RedisKeys.auth.blacklist(payload.jti),
          '1',
          ttl,
        );
      }
    } catch (error) {}
  }

  async hashRefreshToken(refreshToken: string): Promise<string> {
    return await bcrypt.hash(refreshToken, 12);
  }

  async verifyRefreshToken(
    token: string,
    hashedToken: string,
  ): Promise<boolean> {
    return await bcrypt.compare(token, hashedToken);
  }

  async generateResetToken(userId: string, email: string): Promise<string> {
    return this.jwtService.signAsync(
      { sub: userId, email },
      {
        secret: this.configService.get<string>('JWT_RESET_SECRET'),
        expiresIn: '10m',
      },
    );
  }

  async verifyResetToken(token: string): Promise<ResetPasswordPayload> {
    try {
      return await this.jwtService.verifyAsync<ResetPasswordPayload>(token, {
        secret: this.configService.get<string>('JWT_RESET_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired reset token.');
    }
  }
}
