import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from './jwt.strategy';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { cookieExtractor } from '../../common/utils/jwt-extractor.util';

export interface RefreshPayload extends JwtPayload {
  sessionId: string;
  iat: number;
  exp: number;
}

export interface RefreshRequestPayload {
  sub: string;
  email: string;
  sessionId: string;
  refreshToken: string;
}

const refreshTokenExtractor = ExtractJwt.fromExtractors([
  cookieExtractor('refresh_token'),
  ExtractJwt.fromAuthHeaderAsBearerToken(),
]);

@Injectable()
export class RefreshStrategy extends PassportStrategy(Strategy, 'refresh') {
  constructor(private readonly configService: ConfigService) {
    super({
      jwtFromRequest: refreshTokenExtractor,
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_REFRESH_SECRET')!,
      passReqToCallback: true,
    });
  }

  validate(request: Request, payload: RefreshPayload): RefreshRequestPayload {
    const refreshToken = refreshTokenExtractor(request);

    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token not provided');
    }

    return {
      sub: payload.sub,
      email: payload.email,
      sessionId: payload.sessionId,
      refreshToken,
    };
  }
}
