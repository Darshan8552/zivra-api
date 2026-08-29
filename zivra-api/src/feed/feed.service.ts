import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FeedQueryDto } from './dto/feed-query.dto';
import { FollowStatus, PostStatus } from '../generated/prisma/enums';

const DEFAULT_FEED_LIMIT = 12;
const MAX_FEED_LIMIT = 50;

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

@Injectable()
export class FeedService {
  constructor(private readonly prisma: PrismaService) {}

  async getFollowingFeed(viewerId: string, dto: FeedQueryDto) {
    const take = Math.min(dto.limit ?? DEFAULT_FEED_LIMIT, MAX_FEED_LIMIT);

    const follows = await this.prisma.follow.findMany({
      where: { followerId: viewerId, status: FollowStatus.ACCEPTED },
      select: { followingId: true },
    });

    const authorIds = [viewerId, ...follows.map((f) => f.followingId)];

    const posts = await this.prisma.post.findMany({
      where: {
        userId: { in: authorIds },
        status: PostStatus.ACTIVE,
        deletedAt: null,
        user: { status: 'ACTIVE', deletedAt: null },
      },
      take: take + 1,
      ...(dto.cursor ? { cursor: { id: dto.cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: FEED_POST_INCLUDE,
    });

    const hasMore = posts.length > take;
    const items = hasMore ? posts.slice(0, take) : posts;
    const enriched = await this.enrichWithViewerState(items, viewerId);

    return {
      items: enriched,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  async getDiscoveryFeed(viewerId: string, dto: FeedQueryDto) {
    const take = Math.min(dto.limit ?? DEFAULT_FEED_LIMIT, MAX_FEED_LIMIT);

    // 1. Direct followings
    const directFollows = await this.prisma.follow.findMany({
      where: { followerId: viewerId, status: FollowStatus.ACCEPTED },
      select: { followingId: true },
    });
    const directFollowingIds = directFollows.map((f) => f.followingId);
    const excludeDirectSet = new Set([viewerId, ...directFollowingIds]);

    // 2. Second-degree: who do my followings follow
    let secondDegreeIds: string[] = [];
    if (directFollowingIds.length > 0) {
      const secondDegreeRows = await this.prisma.follow.findMany({
        where: {
          followerId: { in: directFollowingIds },
          status: FollowStatus.ACCEPTED,
          followingId: { notIn: [viewerId, ...directFollowingIds] },
        },
        select: { followingId: true },
      });

      const distinct = [...new Set(secondDegreeRows.map((r) => r.followingId))];

      if (distinct.length > 0) {
        // Filter to public, active, not-deleted users only
        const publicUsers = await this.prisma.user.findMany({
          where: {
            id: { in: distinct },
            isPrivate: false,
            deletedAt: null,
            status: 'ACTIVE',
          },
          select: { id: true },
        });
        secondDegreeIds = publicUsers.map((u) => u.id);
      }
    }

    let items: any[] = [];
    let hasMore = false;
    let fetchedPosts: any[] = [];

    // 3. Fetch second-degree posts (cursor applies to this primary source)
    if (secondDegreeIds.length > 0) {
      fetchedPosts = await this.prisma.post.findMany({
        where: {
          userId: { in: secondDegreeIds },
          status: PostStatus.ACTIVE,
          deletedAt: null,
        },
        take: take + 1,
        ...(dto.cursor ? { cursor: { id: dto.cursor }, skip: 1 } : {}),
        orderBy: { createdAt: 'desc' },
        include: FEED_POST_INCLUDE,
      });

      hasMore = fetchedPosts.length > take;
      items = hasMore ? fetchedPosts.slice(0, take) : fetchedPosts;
    }

    // 4. Fallback: if not enough items and no cursor (first page), backfill with trending public posts
    // We only backfill on first page to keep cursor semantics simple
    if (!dto.cursor && items.length < take) {
      const needed = take - items.length;
      const excludeIds = [...excludeDirectSet, ...secondDegreeIds];
      // Avoid duplicate post ids already fetched
      const excludePostIds = items.map((p) => p.id);

      const fallbackPosts = await this.prisma.post.findMany({
        where: {
          userId: { notIn: Array.from(excludeIds) },
          id: excludePostIds.length ? { notIn: excludePostIds } : undefined,
          status: PostStatus.ACTIVE,
          deletedAt: null,
          user: {
            isPrivate: false,
            deletedAt: null,
            status: 'ACTIVE',
          },
        },
        take: needed + 1,
        orderBy: { createdAt: 'desc' },
        include: FEED_POST_INCLUDE,
      });

      const fallbackHasMore = fallbackPosts.length > needed;
      const fallbackItems = fallbackHasMore
        ? fallbackPosts.slice(0, needed)
        : fallbackPosts;

      items = [...items, ...fallbackItems];
      // If fallback had more, we have more pages
      if (fallbackHasMore) hasMore = true;
    }

    const enriched = await this.enrichWithViewerState(items, viewerId);

    return {
      items: enriched,
      nextCursor:
        hasMore && enriched.length > 0
          ? enriched[enriched.length - 1].id
          : null,
    };
  }

  private async enrichWithViewerState(posts: any[], viewerId: string) {
    if (posts.length === 0 || !viewerId) return posts;

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
