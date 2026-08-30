import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { SafeUser } from '../types/safe-user.types';
import type { Request } from 'express';

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): SafeUser => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user: SafeUser }>();
    return request.user;
  },
);
