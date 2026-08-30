import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FeedService } from './feed.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { SafeUser } from '../common/types/safe-user.types';
import { FeedQueryDto } from './dto/feed-query.dto';
import { RedisService } from '../redis/redis.service';
import { RedisKeys } from '../common/utils/redis-keys';
import type { Response } from 'express';

@Controller('feed')
export class FeedController {
  constructor(
    private readonly feedService: FeedService,
    private readonly redis: RedisService,
  ) {}

  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Header('Cache-Control', 'private, max-age=10, stale-while-revalidate=30')
  @Get('following')
  async getFollowingFeed(
    @CurrentUser() user: SafeUser,
    @Query() dto: FeedQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const take = Math.min(dto.limit ?? 12, 50);
    const key = RedisKeys.cache.feedFollowing(user.id, dto.cursor, take);
    let hit = false;
    try {
      hit = (await this.redis.get(key)) !== null;
    } catch {
      hit = false;
    }
    res.setHeader('X-Cache', hit ? 'HIT' : 'MISS');
    return this.feedService.getFollowingFeed(user.id, dto);
  }

  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Header('Cache-Control', 'private, max-age=10, stale-while-revalidate=30')
  @Get('discovery')
  async getDiscoveryFeed(
    @CurrentUser() user: SafeUser,
    @Query() dto: FeedQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const take = Math.min(dto.limit ?? 12, 50);
    const key = RedisKeys.cache.feedDiscovery(user.id, dto.cursor, take);
    let hit = false;
    try {
      hit = (await this.redis.get(key)) !== null;
    } catch {
      hit = false;
    }
    res.setHeader('X-Cache', hit ? 'HIT' : 'MISS');
    return this.feedService.getDiscoveryFeed(user.id, dto);
  }
}
