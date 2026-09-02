import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

@Injectable()
export class GlobalLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger(GlobalLoggerMiddleware.name);

  use(req: Request, res: Response, next: NextFunction) {
    const { method, originalUrl } = req;
    // mute health probes (Render hits /api/health often) to keep logs readable
    if (originalUrl.includes('/health')) {
      return next();
    }
    const startTime = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const { statusCode } = res;
      const message = `${method} ${originalUrl} ${statusCode} ${duration}ms`;
      if (statusCode >= 500) this.logger.error(message);
      else if (statusCode >= 400) this.logger.warn(message);
      else this.logger.log(message);
    });
    next();
  }
}
