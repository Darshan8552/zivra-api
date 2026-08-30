import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';
import { SafeUser } from '../../common/types/safe-user.types';
import { UserStatus } from '../../generated/prisma/enums';
import { cookieExtractor } from '../../common/utils/jwt-extractor.util';
import { RedisService } from 'src/redis/redis.service';
import { RedisKeys } from 'src/common/utils/redis-keys';

export interface JwtPayload {
  sub: string;
  email: string;
  jti: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private redisService: RedisService,
    private usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        cookieExtractor('access_token'),
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_ACCESS_SECRET')!,
    });
  }

  async validate(payload: JwtPayload): Promise<SafeUser> {
    const isBlacklisted = await this.redisService.exists(
      RedisKeys.auth.blacklist(payload.jti),
    );
    if (isBlacklisted) {
      throw new UnauthorizedException('Token has been revoked');
    }
    const user = await this.usersService.findUserById(payload.sub);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('User account is not active');
    }

    return user;
  }
}
