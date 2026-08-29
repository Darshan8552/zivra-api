import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FeedService } from './feed.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { SafeUser } from '../common/types/safe-user.types';
import { FeedQueryDto } from './dto/feed-query.dto';

@Controller('feed')
export class FeedController {
  constructor(private readonly feedService: FeedService) {}

  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Get('following')
  async getFollowingFeed(
    @CurrentUser() user: SafeUser,
    @Query() dto: FeedQueryDto,
  ) {
    return this.feedService.getFollowingFeed(user.id, dto);
  }

  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Get('discovery')
  async getDiscoveryFeed(
    @CurrentUser() user: SafeUser,
    @Query() dto: FeedQueryDto,
  ) {
    return this.feedService.getDiscoveryFeed(user.id, dto);
  }
}
