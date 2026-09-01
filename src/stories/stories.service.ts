import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import {
  FollowStatus,
  MediaType,
  StoryVisibility,
} from '../generated/prisma/enums';
import { canViewStory } from './stories.helper';

const STORY_USER_SELECT = {
  id: true,
  username: true,
  name: true,
  avatarUrl: true,
  isVerified: true,
  isPrivate: true,
} as const;

export interface StoryGroup {
  user: {
    id: string;
    username: string;
    name: string;
    avatarUrl: string | null;
    isVerified: boolean;
    isPrivate: boolean;
  };
  stories: Array<{
    id: string;
    userId: string;
    mediaUrl: string;
    publicId: string;
    type: MediaType;
    visibility: StoryVisibility;
    expiresAt: Date;
    createdAt: Date;
    user: {
      id: string;
      username: string;
      name: string;
      avatarUrl: string | null;
      isVerified: boolean;
      isPrivate: boolean;
    };
    views?: Array<{ id: string; userId: string }>;
  }>;
  seenAll: boolean;
  latestAt: string;
}

@Injectable()
export class StoriesService {
  static readonly MAX_SIZE = 30 * 1024 * 1024; // 30MB
  static readonly MAX_DURATION = 30; // seconds
  static readonly MAX_PER_DAY = 10;

  readonly MAX_SIZE = StoriesService.MAX_SIZE;
  readonly MAX_DURATION = StoriesService.MAX_DURATION;
  readonly MAX_PER_DAY = StoriesService.MAX_PER_DAY;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async create(
    userId: string,
    file: Express.Multer.File,
    visibility?: StoryVisibility,
  ) {
    if (!file) {
      throw new HttpException('File is required', HttpStatus.BAD_REQUEST);
    }

    if (file.size > this.MAX_SIZE) {
      throw new HttpException(
        'File too large. Max 30MB',
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
      // alternative: throw new PayloadTooLargeException('File too large. Max 30MB');
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const count = await this.prisma.story.count({
      where: {
        userId,
        createdAt: { gte: since },
      },
    });

    if (count >= this.MAX_PER_DAY) {
      throw new HttpException(
        'Story limit reached (10 per 24h)',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const uploaded = await this.cloudinary.uploadBuffer(
      file,
      `stories/${userId}`,
    );

    // video duration check via Cloudinary result.duration
    if (
      uploaded.resourceType === 'video' &&
      typeof uploaded.duration === 'number' &&
      uploaded.duration > this.MAX_DURATION
    ) {
      // compensating delete
      await this.cloudinary.deleteAsset(uploaded.publicId, 'video');
      throw new UnprocessableEntityException(
        `Video exceeds ${this.MAX_DURATION}s limit`,
      );
    }

    const visibilityValue = visibility ?? StoryVisibility.PUBLIC;

    try {
      const story = await this.prisma.$transaction(async (tx) => {
        return tx.story.create({
          data: {
            userId,
            mediaUrl: uploaded.url,
            publicId: uploaded.publicId,
            type:
              uploaded.resourceType === 'video'
                ? MediaType.VIDEO
                : MediaType.IMAGE,
            visibility: visibilityValue,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
          include: {
            user: { select: STORY_USER_SELECT },
          },
        });
      });
      return story;
    } catch (e) {
      // compensating deleteMany (single asset) on txn fail
      await this.cloudinary
        .deleteAsset(uploaded.publicId, uploaded.resourceType)
        .catch(() => {});
      throw e;
    }
  }

  async getFeed(
    viewerId: string | null,
    cursor?: string,
    limit?: number,
  ): Promise<{ groups: StoryGroup[]; nextCursor: string | null }> {
    const takeLimit = limit ?? 20;
    const effectiveLimit =
      Number.isFinite(takeLimit) && takeLimit >= 1 && takeLimit <= 50
        ? Math.floor(takeLimit)
        : 20;

    const now = new Date();

    // fetch active stories where expiresAt > now, include user and views if viewerId
    const stories = await this.prisma.story.findMany({
      where: {
        expiresAt: { gt: now },
      },
      include: {
        user: { select: STORY_USER_SELECT },
        views: viewerId
          ? { where: { userId: viewerId }, select: { id: true, userId: true } }
          : false,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    if (stories.length === 0) {
      return { groups: [], nextCursor: null };
    }

    // batch lookups for isCloseFriend and followStatus
    const distinctUserIds = [
      ...new Set(stories.map((s) => s.userId).filter((id) => id !== viewerId)),
    ];

    let closeFriendSet = new Set<string>();
    let followAcceptedSet = new Set<string>();

    if (viewerId && distinctUserIds.length > 0) {
      const [closeFriends, follows] = await Promise.all([
        this.prisma.closeFriend.findMany({
          where: {
            userId: { in: distinctUserIds },
            friendId: viewerId,
          },
          select: { userId: true },
        }),
        this.prisma.follow.findMany({
          where: {
            followerId: viewerId,
            followingId: { in: distinctUserIds },
            status: FollowStatus.ACCEPTED,
          },
          select: { followingId: true },
        }),
      ]);
      closeFriendSet = new Set(closeFriends.map((cf) => cf.userId));
      followAcceptedSet = new Set(follows.map((f) => f.followingId));
    }

    // filter via canViewStory
    const visible = stories.filter((story) => {
      const isCloseFriend = closeFriendSet.has(story.userId);
      const followStatus = followAcceptedSet.has(story.userId)
        ? FollowStatus.ACCEPTED
        : null;
      return canViewStory(
        viewerId,
        story.user as { id: string; isPrivate: boolean },
        story.visibility as StoryVisibility,
        isCloseFriend,
        followStatus,
      );
    });

    // group by userId into StoryGroup
    const grouped = new Map<string, StoryGroup>();

    for (const story of visible) {
      const existing = grouped.get(story.userId);
      // compute seen for this story: viewer has viewed if views array non-empty
      // For grouping we will compute seenAll later from all stories in group
      if (!existing) {
        grouped.set(story.userId, {
          user: story.user as StoryGroup['user'],
          stories: [story as StoryGroup['stories'][number]],
          seenAll: false, // placeholder
          latestAt: story.createdAt.toISOString(),
        });
      } else {
        existing.stories.push(story as StoryGroup['stories'][number]);
        // update latestAt to max createdAt
        const currentLatest = new Date(existing.latestAt).getTime();
        const storyTime = new Date(story.createdAt).getTime();
        if (storyTime > currentLatest) {
          existing.latestAt = story.createdAt.toISOString();
        }
      }
    }

    // compute seenAll per group and sort stories within group asc by createdAt
    for (const group of grouped.values()) {
      group.stories.sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      if (viewerId) {
        // seenAll true if every story has viewer view
        // viewer own stories: seenAll true (self always seen)
        if (group.user.id === viewerId) {
          group.seenAll = true;
        } else {
          group.seenAll = group.stories.every(
            (s) => Array.isArray((s as any).views) && (s as any).views.length > 0,
          );
        }
      } else {
        group.seenAll = false;
      }
    }

    let groups = Array.from(grouped.values());

    // sort by latestAt desc
    groups.sort(
      (a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime(),
    );

    // cursor pagination on grouped latestAt
    if (cursor) {
      const parsedDate = new Date(cursor);
      const isValidDate = !isNaN(parsedDate.getTime()) && cursor.includes('T');
      if (isValidDate) {
        // cursor is ISO timestamp: filter groups with latestAt < cursor
        groups = groups.filter(
          (g) => new Date(g.latestAt).getTime() < parsedDate.getTime(),
        );
      } else {
        // try treat cursor as userId of last seen group
        const idx = groups.findIndex((g) => g.user.id === cursor);
        if (idx >= 0) {
          groups = groups.slice(idx + 1);
        } else {
          // also try matching story id cursor?
          const storyIdx = groups.findIndex((g) =>
            g.stories.some((s) => s.id === cursor),
          );
          if (storyIdx >= 0) {
            groups = groups.slice(storyIdx + 1);
          }
          // else keep groups as is (invalid cursor -> first page)
        }
      }
    }

    // paginate by limit
    const paginated = groups.slice(0, effectiveLimit);
    const hasMore = groups.length > effectiveLimit;
    const nextCursor = hasMore
      ? paginated[paginated.length - 1].latestAt
      : null;

    // Alternatively if we used userId cursor, nextCursor could be last user id
    // But per spec we use latestAt as cursor, which caller can pass back as cursor

    return { groups: paginated, nextCursor };
  }

  async getUserStories(username: string, viewerId: string | null) {
    const user = await this.prisma.user.findFirst({
      where: { username, deletedAt: null },
      select: {
        id: true,
        username: true,
        name: true,
        avatarUrl: true,
        isVerified: true,
        isPrivate: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const now = new Date();
    const stories = await this.prisma.story.findMany({
      where: {
        userId: user.id,
        expiresAt: { gt: now },
      },
      include: {
        user: { select: STORY_USER_SELECT },
        views: viewerId
          ? { where: { userId: viewerId }, select: { id: true, userId: true } }
          : false,
      },
      orderBy: { createdAt: 'asc' },
    });

    if (stories.length === 0) return [];

    let isCloseFriend = false;
    let followStatus: FollowStatus | null = null;

    if (viewerId && viewerId !== user.id) {
      const [cf, follow] = await Promise.all([
        this.prisma.closeFriend.findFirst({
          where: { userId: user.id, friendId: viewerId },
          select: { id: true },
        }),
        this.prisma.follow.findUnique({
          where: {
            followerId_followingId: {
              followerId: viewerId,
              followingId: user.id,
            },
          },
          select: { status: true },
        }),
      ]);
      isCloseFriend = Boolean(cf);
      followStatus = follow?.status ?? null;
    }

    const visible = stories.filter((story) =>
      canViewStory(
        viewerId,
        user as { id: string; isPrivate: boolean },
        story.visibility as StoryVisibility,
        isCloseFriend,
        followStatus,
      ),
    );

    return visible;
  }

  async markViewed(viewerId: string, storyId: string) {
    const story = await this.prisma.story.findFirst({
      where: {
        id: storyId,
        expiresAt: { gt: new Date() },
      },
      include: {
        user: { select: STORY_USER_SELECT },
      },
    });

    if (!story) {
      throw new NotFoundException('Story not found');
    }

    // privacy check
    let isCloseFriend = false;
    let followStatus: FollowStatus | null = null;

    if (viewerId !== story.userId) {
      const [cf, follow] = await Promise.all([
        this.prisma.closeFriend.findFirst({
          where: { userId: story.userId, friendId: viewerId },
          select: { id: true },
        }),
        this.prisma.follow.findUnique({
          where: {
            followerId_followingId: {
              followerId: viewerId,
              followingId: story.userId,
            },
          },
          select: { status: true },
        }),
      ]);
      isCloseFriend = Boolean(cf);
      followStatus = follow?.status ?? null;

      const allowed = canViewStory(
        viewerId,
        story.user as { id: string; isPrivate: boolean },
        story.visibility as StoryVisibility,
        isCloseFriend,
        followStatus,
      );

      if (!allowed) {
        throw new ForbiddenException('You do not have permission to view this story');
      }
    }

    // upsert storyView where storyId_userId
    return this.prisma.storyView.upsert({
      where: {
        storyId_userId: { storyId, userId: viewerId },
      },
      update: {},
      create: { storyId, userId: viewerId },
    });
  }

  async delete(userId: string, storyId: string) {
    const story = await this.prisma.story.findFirst({
      where: { id: storyId, userId },
    });

    if (!story) {
      throw new NotFoundException('Story not found');
    }

    await this.prisma.story.delete({ where: { id: storyId } });

    await this.cloudinary.deleteAsset(
      story.publicId,
      story.type === MediaType.VIDEO ? 'video' : 'image',
    );

    return { id: storyId };
  }

  /**
   * Cron cleanup: hard-delete expired stories + Cloudinary cleanup.
   * Scheduled at 0 3 * * * (3AM daily). If @nestjs/schedule is available,
   * decorate with @Cron('0 3 * * *'). Otherwise invoke manually.
   */
  // @Cron('0 3 * * *') // enable when @nestjs/schedule installed
  async cleanupExpired(): Promise<{ deleted: number }> {
    const now = new Date();
    const expired = await this.prisma.story.findMany({
      where: { expiresAt: { lte: now } },
      select: { id: true, publicId: true, type: true },
    });

    if (expired.length === 0) {
      return { deleted: 0 };
    }

    // Build Cloudinary refs
    const assets = expired.map((s) => ({
      publicId: s.publicId,
      resourceType: (s.type === MediaType.VIDEO ? 'video' : 'image') as 'image' | 'video',
    }));

    // deleteMany db
    await this.prisma.story.deleteMany({
      where: { id: { in: expired.map((s) => s.id) } },
    });

    // cloudinary deleteMany
    await this.cloudinary.deleteMany(assets).catch(() => {});

    console.log(`[StoriesService] cleanupExpired deleted ${expired.length} stories`);
    return { deleted: expired.length };
  }
}
