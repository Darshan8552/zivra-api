import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RefreshRequestPayload } from '../../auth/strategies/refresh.strategy';

export const GetRefreshPayload = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): RefreshRequestPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
