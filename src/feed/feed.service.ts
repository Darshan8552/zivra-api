import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FeedQueryDto } from './dto/feed-query.dto';
import { FollowStatus, PostStatus } from '../generated/prisma/enums';
import { Prisma } from '../generated/prisma/client';
import {
  decodeFeedCursor,
  encodeFeedCursor,
  isUuidV7,
} from '../common/utils/cursor.util';
import { RedisService } from '../redis/redis.service';
import { RedisKeys } from '../common/utils/redis-keys';

const DEFAULT_FEED_LIMIT = 12;
const MAX_FEED_LIMIT = 50;
const FEED_IN_CHUNK_SIZE = 500;
const FEED_CACHE_TTL_SECONDS = 30;

function chunk<T>(array: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < array.length; i += size)
    out.push(array.slice(i, i + size));
  return out;
}

const FEED_POST_INCLUDE = {
  user: {
    select: {
      id: true,
      username: true,
      name: true,
      avatarUrl: true,
      isVerified: true,
    },
  },
  media: { orderBy: { order: 'asc' as const } },
  hashtags: { include: { hashtag: true } },
  userTags: {
    include: {
      user: {
        select: { id: true, username: true, name: true, avatarUrl: true },
      },
    },
  },
  _count: { select: { likes: true, comments: true } },
} as const;

type FeedPost = Prisma.PostGetPayload<{ include: typeof FEED_POST_INCLUDE }>;
type FeedPostEnriched = FeedPost & { liked: boolean; bookmarked: boolean };

@Injectable()
export class FeedService {
  private readonly logger = new Logger(FeedService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  private async resolveFeedCursor(
    cursor?: string,
  ): Promise<{ createdAt: Date; id: string } | null> {
    if (!cursor) return null;
    try {
      return decodeFeedCursor(cursor);
    } catch {
      if (isUuidV7(cursor)) {
        const post = await this.prisma.post.findUnique({
          where: { id: cursor },
          select: { createdAt: true },
        });
        if (post) return { createdAt: post.createdAt, id: cursor };
      }
      throw new BadRequestException('Invalid cursor');
    }
  }

  private buildKeysetWhere(cursor: { createdAt: Date; id: string } | null) {
    if (!cursor) return null;
    return {
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ],
    } as const;
  }

  async getFollowingFeed(viewerId: string, dto: FeedQueryDto) {
    const take = Math.min(dto.limit ?? DEFAULT_FEED_LIMIT, MAX_FEED_LIMIT);
    const cacheKey = RedisKeys.cache.feedFollowing(viewerId, dto.cursor, take);
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached)
        return JSON.parse(cached) as {
          items: FeedPostEnriched[];
          nextCursor: string | null;
        };
    } catch (err) {
      this.logger.warn(
        `Feed cache get failed ${cacheKey}: ${(err as Error).message}`,
      );
    }
    const resolved = await this.resolveFeedCursor(dto.cursor);
    const keyset = this.buildKeysetWhere(resolved);

    const baseWhere = {
      status: PostStatus.ACTIVE,
      deletedAt: null,
      user: { status: 'ACTIVE', deletedAt: null },
      OR: [
        { userId: viewerId },
        {
          user: {
            followsReceived: {
              some: { followerId: viewerId, status: FollowStatus.ACCEPTED },
            },
          },
        },
      ],
    } as const;

    const where: Record<string, unknown> = keyset
      ? {
          AND: [
            baseWhere as unknown as Record<string, unknown>,
            keyset as unknown as Record<string, unknown>,
          ],
        }
      : baseWhere;

    const posts = await this.prisma.post.findMany({
      where: where as never,
      take: take + 1,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: FEED_POST_INCLUDE,
    });

    const hasMore = posts.length > take;
    const items = hasMore ? posts.slice(0, take) : posts;
    const enriched = await this.enrichWithViewerState(items, viewerId);

    const result = {
      items: enriched,
      nextCursor: hasMore
        ? encodeFeedCursor({
            createdAt: (items[items.length - 1] as { createdAt: Date })
              .createdAt,
            id: items[items.length - 1].id,
          })
        : null,
    };
    try {
      await this.redis.setEx(
        cacheKey,
        JSON.stringify(result),
        FEED_CACHE_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(
        `Feed cache set failed ${cacheKey}: ${(err as Error).message}`,
      );
    }
    return result;
  }

  async getDiscoveryFeed(viewerId: string, dto: FeedQueryDto) {
    const take = Math.min(dto.limit ?? DEFAULT_FEED_LIMIT, MAX_FEED_LIMIT);
    const cacheKey = RedisKeys.cache.feedDiscovery(viewerId, dto.cursor, take);
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached)
        return JSON.parse(cached) as {
          items: FeedPostEnriched[];
          nextCursor: string | null;
        };
    } catch (err) {
      this.logger.warn(
        `Feed cache get failed ${cacheKey}: ${(err as Error).message}`,
      );
    }
    const resolved = await this.resolveFeedCursor(dto.cursor);
    const keyset = this.buildKeysetWhere(resolved);

    const directFollows = await this.prisma.follow.findMany({
      where: { followerId: viewerId, status: FollowStatus.ACCEPTED },
      select: { followingId: true },
    });
    const directFollowingIds = directFollows.map((f) => f.followingId);
    const excludeDirectSet = new Set([viewerId, ...directFollowingIds]);

    let secondDegreeIds: string[] = [];
    if (directFollowingIds.length > 0) {
      const excludeDirectArr = [viewerId, ...directFollowingIds];
      const distinctSet = new Set<string>();
      for (const ids of chunk(directFollowingIds, FEED_IN_CHUNK_SIZE)) {
        const rows = await this.prisma.follow.findMany({
          where: {
            followerId: { in: ids },
            status: FollowStatus.ACCEPTED,
            followingId: { notIn: excludeDirectArr },
          },
          select: { followingId: true },
        });
        for (const r of rows) distinctSet.add(r.followingId);
      }
      const distinct = [...distinctSet];

      if (distinct.length > 0) {
        const publicIds: string[] = [];
        for (const ids of chunk(distinct, FEED_IN_CHUNK_SIZE)) {
          const users = await this.prisma.user.findMany({
            where: {
              id: { in: ids },
              isPrivate: false,
              deletedAt: null,
              status: 'ACTIVE',
            },
            select: { id: true },
          });
          for (const u of users) publicIds.push(u.id);
        }
        secondDegreeIds = publicIds;
      }
    }

    const buildSecondDegreeBase = (ids: string[]) => {
      const base: Record<string, unknown> = {
        userId: { in: ids },
        status: PostStatus.ACTIVE,
        deletedAt: null,
      };
      if (keyset)
        return {
          AND: [base, keyset as unknown as Record<string, unknown>],
        } as unknown as Record<string, unknown>;
      return base;
    };

    const fetchSecondDegreePage = async (): Promise<FeedPost[]> => {
      if (secondDegreeIds.length === 0) return [];
      if (secondDegreeIds.length <= FEED_IN_CHUNK_SIZE) {
        return this.prisma.post.findMany({
          where: buildSecondDegreeBase(secondDegreeIds) as never,
          take: take + 1,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          include: FEED_POST_INCLUDE,
        });
      }
      const perChunk: FeedPost[][] = [];
      for (const ids of chunk(secondDegreeIds, FEED_IN_CHUNK_SIZE)) {
        const posts = await this.prisma.post.findMany({
          where: buildSecondDegreeBase(ids) as never,
          take: take + 1,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          include: FEED_POST_INCLUDE,
        });
        perChunk.push(posts);
      }
      const merged = perChunk.flat().sort((a, b) => {
        const ta =
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        if (ta !== 0) return ta;
        return String(b.id).localeCompare(String(a.id));
      });
      return merged.slice(0, take + 1);
    };

    const fetchFallbackPage = async (): Promise<FeedPost[]> => {
      const excludeIds = [...excludeDirectSet, ...secondDegreeIds];
      const excludeUserSet = new Set(excludeIds);

      if (excludeUserSet.size <= FEED_IN_CHUNK_SIZE) {
        const base: Record<string, unknown> = {
          userId: { notIn: Array.from(excludeIds) },
          status: PostStatus.ACTIVE,
          deletedAt: null,
          user: { isPrivate: false, deletedAt: null, status: 'ACTIVE' },
        };
        const where: Record<string, unknown> = keyset
          ? { AND: [base, keyset as unknown as Record<string, unknown>] }
          : base;
        return this.prisma.post.findMany({
          where: where as never,
          take: take + 1,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          include: FEED_POST_INCLUDE,
        });
      }

      const overscan = take + FEED_IN_CHUNK_SIZE;
      const base: Record<string, unknown> = {
        status: PostStatus.ACTIVE,
        deletedAt: null,
        user: { isPrivate: false, deletedAt: null, status: 'ACTIVE' },
      };
      const where: Record<string, unknown> = keyset
        ? { AND: [base, keyset as unknown as Record<string, unknown>] }
        : base;
      const candidates = await this.prisma.post.findMany({
        where: where as never,
        take: overscan + 1,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: FEED_POST_INCLUDE,
      });
      const filtered = candidates.filter(
        (p: FeedPost) => !excludeUserSet.has(p.userId),
      );
      return filtered.slice(0, take + 1);
    };

    const [secondDegreePage, fallbackPage] = await Promise.all([
      fetchSecondDegreePage(),
      fetchFallbackPage(),
    ]);

    const merged = [...secondDegreePage, ...fallbackPage].sort((a, b) => {
      const ta =
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (ta !== 0) return ta;
      return String(b.id).localeCompare(String(a.id));
    });
    const sliced = merged.slice(0, take + 1);
    const hasMore = sliced.length > take;
    const items: FeedPost[] = hasMore ? sliced.slice(0, take) : sliced;

    const enriched = await this.enrichWithViewerState(items, viewerId);

    const result = {
      items: enriched,
      nextCursor:
        hasMore && enriched.length > 0
          ? encodeFeedCursor({
              createdAt: (enriched[enriched.length - 1] as { createdAt: Date })
                .createdAt,
              id: enriched[enriched.length - 1].id,
            })
          : null,
    };
    try {
      await this.redis.setEx(
        cacheKey,
        JSON.stringify(result),
        FEED_CACHE_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(
        `Feed cache set failed ${cacheKey}: ${(err as Error).message}`,
      );
    }
    return result;
  }

  private async enrichWithViewerState(
    posts: FeedPost[],
    viewerId: string,
  ): Promise<FeedPostEnriched[]> {
    if (posts.length === 0 || !viewerId) return posts as FeedPostEnriched[];

    const postIds = posts.map((p) => p.id);

    const [likes, bookmarks] = await Promise.all([
      this.prisma.postLike.findMany({
        where: { userId: viewerId, postId: { in: postIds } },
        select: { postId: true },
      }),
      this.prisma.bookmark.findMany({
        where: { userId: viewerId, postId: { in: postIds } },
        select: { postId: true },
      }),
    ]);

    const likedSet = new Set(likes.map((l) => l.postId));
    const bookmarkedSet = new Set(bookmarks.map((b) => b.postId));

    return posts.map((post) => ({
      ...post,
      liked: likedSet.has(post.id),
      bookmarked: bookmarkedSet.has(post.id),
    }));
  }
}
