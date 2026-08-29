import { Injectable } from '@nestjs/common';
import {
  HealthCheckError,
  HealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(private readonly redis: RedisService) {
    super();
  }

  async isHealthy(key = 'redis'): Promise<HealthIndicatorResult> {
    try {
      const result = await this.redis.ping();
      const isHealthy = result === 'PONG';
      return this.getStatus(key, isHealthy, { message: result });
    } catch (e) {
      throw new HealthCheckError(
        'Redis check failed',
        this.getStatus(key, false, {
          message: (e as Error).message,
        }),
      );
    }
  }
}
