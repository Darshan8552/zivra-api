import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context) as boolean | Promise<boolean>;
  }

  handleRequest<TUser>(
    err: unknown,
    user: TUser | false | null,
    info: unknown,
    _context: ExecutionContext,
  ): TUser {
    if (err) {
      throw err instanceof Error ? err : new UnauthorizedException();
    }

    if (!user) {
      const infoName =
        typeof info === 'object' && info !== null && 'name' in info
          ? String(info.name)
          : undefined;
      const infoMessage =
        typeof info === 'object' && info !== null && 'message' in info
          ? String(info.message)
          : undefined;

      if (infoName === 'TokenExpiredError') {
        throw new UnauthorizedException('Access token expired');
      }
      if (infoName === 'JsonWebTokenError') {
        throw new UnauthorizedException(infoMessage ?? 'Invalid token');
      }
      if (infoName === 'NotBeforeError') {
        throw new UnauthorizedException('Token not active yet');
      }
      throw new UnauthorizedException(infoMessage ?? 'Unauthorized');
    }

    return user;
  }
}
