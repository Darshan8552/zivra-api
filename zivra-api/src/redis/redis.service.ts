import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor(private readonly configService: ConfigService) {
    const redisUrl = this.configService.get<string>('UPSTASH_REDIS_URL');
    if (!redisUrl) {
      throw new Error(
        'UPSTASH_REDIS_URL is not defined in environment variables',
      );
    }
    this.client = new Redis(redisUrl, {
      tls: redisUrl.startsWith('rediss://') ? {} : undefined,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) {
          this.logger.error(`Redis connection failed after ${times} retries.`);
          return null;
        }
        return Math.min(times * 200, 2000);
      },
    });
    this.setupEventListeners();
  }

  private setupEventListeners() {
    this.client.on('connect', () => {
      this.logger.log('Successfully connected to Upstash Redis');
    });

    this.client.on('error', (err) => {
      this.logger.error(`Redis Client Error: ${err.message}`);
    });
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    await this.client.set(key, value);
  }

  async setEx(key: string, value: string, seconds: number): Promise<void> {
    await this.client.set(key, value, 'EX', seconds);
  }

  async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result > 0;
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    const result = await this.client.expire(key, seconds);
    return result === 1;
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async decr(key: string): Promise<number> {
    return this.client.decr(key);
  }

  async incrBy(key: string, amount: number): Promise<number> {
    return this.client.incrby(key, amount);
  }

  async sAdd(key: string, ...members: string[]): Promise<number> {
    return this.client.sadd(key, ...members);
  }

  async sRem(key: string, ...members: string[]): Promise<number> {
    return this.client.srem(key, ...members);
  }

  async sMembers(key: string): Promise<string[]> {
    return this.client.smembers(key);
  }

  async sIsMember(key: string, member: string): Promise<boolean> {
    const result = await this.client.sismember(key, member);
    return result === 1;
  }

  async sDel(key: string): Promise<number> {
    return this.client.del(key);
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }

  getStatus(): string {
    return this.client.status;
  }

  async onModuleDestroy() {
    this.logger.log('Disconnecting from Upstash Redis...');
    await this.client.quit();
  }
}
