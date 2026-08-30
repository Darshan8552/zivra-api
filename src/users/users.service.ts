import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  UserUpdateInput,
  UserCreateInput,
} from '../generated/prisma/models/User';
import { SafeUser } from '../common/types/safe-user.types';
import { SearchUsersDto } from './dto/search-users.dto';
import { PaginatePostsDto } from './dto/paginate-posts.dto';
import {
  FollowStatus,
  NotificationType,
  PostStatus,
} from '../generated/prisma/enums';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { NotificationsService } from '../notifications/notifications.service';

const DEFAULT_SEARCH_LIMIT = 12;
const MAX_SEARCH_LIMIT = 50;
const DEFAULT_POSTS_PAGE_SIZE = 12;
const MAX_POSTS_PAGE_SIZE = 50;
const DEFAULT_FOLLOW_LIST_PAGE_SIZE = 20;
const MAX_FOLLOW_LIST_PAGE_SIZE = 50;

const PROFILE_POST_INCLUDE = {
  media: { orderBy: { order: 'asc' as const }, take: 1 },
  _count: { select: { likes: true, comments: true } },
};

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
    private readonly notifications: NotificationsService,
  ) {}

  async getSuggestions(viewerId: string, limit = 10) {
    const followed = await this.prisma.follow.findMany({
      where: {
        followerId: viewerId,
        status: { in: [FollowStatus.ACCEPTED, FollowStatus.PENDING] },
      },
      select: { followingId: true },
    });

    const excludeIds = [viewerId, ...followed.map((f) => f.followingId)];

    const users = await this.prisma.user.findMany({
      where: {
        id: { notIn: excludeIds },
        status: 'ACTIVE',
        deletedAt: null,
      },
      orderBy: [{ isVerified: 'desc' }, { followerCount: 'desc' }],
      take: limit,
      select: {
        id: true,
        username: true,
        name: true,
        avatarUrl: true,
        isVerified: true,
        isPrivate: true,
      },
    });

    return users.map((u) => ({
      ...u,
      reason: u.isVerified ? 'Popular creator' : 'Suggested for you',
    }));
  }

  async getUserFollowers(
    username: string,
    viewerId: string,
    cursor?: string,
    limit = DEFAULT_FOLLOW_LIST_PAGE_SIZE,
  ) {
    const user = await this.prisma.user.findFirst({
      where: { username, deletedAt: null },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const take = Math.min(limit, MAX_FOLLOW_LIST_PAGE_SIZE);

    const follows = await this.prisma.follow.findMany({
      where: { followingId: user.id, status: FollowStatus.ACCEPTED },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: {
        follower: {
          select: {
            id: true,
            name: true,
            username: true,
            avatarUrl: true,
            isVerified: true,
            isPrivate: true,
          },
        },
      },
    });

    const followerIds = follows.map((f) => f.follower.id);
    const viewerFollows = await this.prisma.follow.findMany({
      where: {
        followerId: viewerId,
        followingId: { in: followerIds },
        status: FollowStatus.ACCEPTED,
      },
      select: { followingId: true, status: true },
    });
    const viewerFollowMap = new Map(
      viewerFollows.map((f) => [f.followingId, f.status]),
    );

    const hasMore = follows.length > take;
    const items = hasMore ? follows.slice(0, take) : follows;

    return {
      items: items.map((f) => ({
        ...f.follower,
        isFollowing: viewerFollowMap.has(f.follower.id),
        followStatus: viewerFollowMap.get(f.follower.id) ?? null,
      })),
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  async getUserFollowing(
    username: string,
    viewerId: string,
    cursor?: string,
    limit = DEFAULT_FOLLOW_LIST_PAGE_SIZE,
  ) {
    const user = await this.prisma.user.findFirst({
      where: { username, deletedAt: null },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const take = Math.min(limit, MAX_FOLLOW_LIST_PAGE_SIZE);

    const follows = await this.prisma.follow.findMany({
      where: { followerId: user.id, status: FollowStatus.ACCEPTED },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: {
        following: {
          select: {
            id: true,
            name: true,
            username: true,
            avatarUrl: true,
            isVerified: true,
            isPrivate: true,
          },
        },
      },
    });

    const followingIds = follows.map((f) => f.following.id);
    const viewerFollows = await this.prisma.follow.findMany({
      where: {
        followerId: viewerId,
        followingId: { in: followingIds },
        status: FollowStatus.ACCEPTED,
      },
      select: { followingId: true, status: true },
    });
    const viewerFollowMap = new Map(
      viewerFollows.map((f) => [f.followingId, f.status]),
    );

    const hasMore = follows.length > take;
    const items = hasMore ? follows.slice(0, take) : follows;

    return {
      items: items.map((f) => ({
        ...f.following,
        isFollowing: viewerFollowMap.has(f.following.id),
        followStatus: viewerFollowMap.get(f.following.id) ?? null,
      })),
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  async toggleFollow(viewerId: string, username: string) {
    const target = await this.prisma.user.findFirst({
      where: { username, deletedAt: null, status: 'ACTIVE' },
      select: { id: true, isPrivate: true, followerCount: true },
    });
    if (!target) throw new NotFoundException('User not found');
    if (target.id === viewerId)
      throw new BadRequestException('You cannot follow yourself');

    const where = {
      followerId_followingId: { followerId: viewerId, followingId: target.id },
    } as const;

    const existing = await this.prisma.follow.findUnique({
      where,
      select: { status: true },
    });

    if (existing?.status === FollowStatus.ACCEPTED) {
      await this.prisma.$transaction([
        this.prisma.follow.delete({ where }),
        this.prisma.user.update({
          where: { id: target.id },
          data: { followerCount: { decrement: 1 } },
        }),
        this.prisma.user.update({
          where: { id: viewerId },
          data: { followingCount: { decrement: 1 } },
        }),
      ]);
      return {
        isFollowing: false,
        followStatus: null,
        followerCount: target.followerCount - 1,
      };
    }

    if (existing?.status === FollowStatus.PENDING) {
      await this.prisma.follow.delete({ where });
      return {
        isFollowing: false,
        followStatus: null,
        followerCount: target.followerCount,
      };
    }

    const status = target.isPrivate
      ? FollowStatus.PENDING
      : FollowStatus.ACCEPTED;

    if (existing?.status === FollowStatus.REJECTED) {
      await this.prisma.follow.update({ where, data: { status } });
    } else {
      await this.prisma.follow.create({
        data: { followerId: viewerId, followingId: target.id, status },
      });
    }

    if (status === FollowStatus.ACCEPTED) {
      await this.prisma.$transaction([
        this.prisma.user.update({
          where: { id: target.id },
          data: { followerCount: { increment: 1 } },
        }),
        this.prisma.user.update({
          where: { id: viewerId },
          data: { followingCount: { increment: 1 } },
        }),
      ]);
      await this.notifications.create({
        userId: target.id,
        actorId: viewerId,
        type: NotificationType.FOLLOW,
        entityType: 'USER',
        entityId: target.id,
      });
    } else {
      await this.notifications.create({
        userId: target.id,
        actorId: viewerId,
        type: NotificationType.FOLLOW_REQUEST,
        entityType: 'USER',
        entityId: target.id,
      });
    }

    const updated = await this.prisma.user.findUnique({
      where: { id: target.id },
      select: { followerCount: true },
    });

    return {
      isFollowing: status === FollowStatus.ACCEPTED,
      followStatus: status,
      followerCount: updated?.followerCount ?? target.followerCount,
    };
  }

  async respondToFollowRequest(
    viewerId: string,
    actorId: string,
    accept: boolean,
  ) {
    const where = {
      followerId_followingId: {
        followerId: actorId,
        followingId: viewerId,
      },
    } as const;

    const follow = await this.prisma.follow.findUnique({
      where,
      select: { status: true },
    });

    if (!follow) {
      return { success: true };
    }

    if (accept) {
      if (follow.status === FollowStatus.ACCEPTED) {
        return { success: true };
      }
      await this.prisma.$transaction([
        this.prisma.follow.update({
          where,
          data: { status: FollowStatus.ACCEPTED },
        }),
        this.prisma.user.update({
          where: { id: viewerId },
          data: { followerCount: { increment: 1 } },
        }),
        this.prisma.user.update({
          where: { id: actorId },
          data: { followingCount: { increment: 1 } },
        }),
      ]);
      await this.notifications.create({
        userId: actorId,
        actorId: viewerId,
        type: NotificationType.FOLLOW_ACCEPTED,
        entityType: 'USER',
        entityId: viewerId,
      });
    } else {
      if (follow.status === FollowStatus.REJECTED) {
        return { success: true };
      }
      await this.prisma.follow.update({
        where,
        data: { status: FollowStatus.REJECTED },
      });
    }

    return { success: true };
  }

  async findUserByEmail(email: string): Promise<SafeUser | null> {
    return await this.prisma.user.findUnique({
      where: { email },
      omit: { passwordHash: true },
    });
  }

  async findUserById(id: string): Promise<SafeUser | null> {
    return await this.prisma.user.findUnique({
      where: { id },
      omit: { passwordHash: true },
    });
  }

  async createUser(data: UserCreateInput): Promise<SafeUser> {
    return await this.prisma.user.create({
      data,
      omit: { passwordHash: true },
    });
  }

  async updateUser(
    id: string,
    data: UserUpdateInput,
  ): Promise<SafeUser | null> {
    return await this.prisma.user.update({
      where: { id },
      data,
      omit: {
        passwordHash: true,
      },
    });
  }

  async searchUsers(dto: SearchUsersDto, excludeUserId: string) {
    const term = dto.q?.trim();
    if (!term) return [];

    const take = Math.min(
      Math.max(dto.limit ?? DEFAULT_SEARCH_LIMIT, 1),
      MAX_SEARCH_LIMIT,
    );

    return this.prisma.user.findMany({
      where: {
        id: { not: excludeUserId },
        status: 'ACTIVE',
        deletedAt: null,
        OR: [
          { username: { contains: term, mode: 'insensitive' } },
          { name: { contains: term, mode: 'insensitive' } },
        ],
      },
      take,
      orderBy: [{ isVerified: 'desc' }, { followerCount: 'desc' }],
      select: {
        id: true,
        username: true,
        name: true,
        avatarUrl: true,
        isVerified: true,
      },
    });
  }

  async getPublicProfile(username: string, viewerId: string) {
    const user = await this.prisma.user.findFirst({
      where: { username, deletedAt: null },
      omit: { passwordHash: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isOwnProfile = viewerId === user.id;
    let isFollowing = false;
    let followStatus: string | null = null;

    if (!isOwnProfile) {
      const follow = await this.prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: viewerId,
            followingId: user.id,
          },
        },
        select: { status: true },
      });
      followStatus = follow?.status ?? null;
      isFollowing = follow?.status === 'ACCEPTED';
    }

    return {
      ...user,
      isOwnProfile,
      isFollowing,
      followStatus,
      canViewPosts: isOwnProfile || !user.isPrivate || isFollowing,
    };
  }

  private async canViewPosts(
    user: { id: string; isPrivate: boolean },
    viewerId: string,
  ): Promise<boolean> {
    if (!user.isPrivate) return true;
    if (user.id === viewerId) return true;
    const follow = await this.prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: viewerId,
          followingId: user.id,
        },
      },
      select: { status: true },
    });
    return follow?.status === FollowStatus.ACCEPTED;
  }

  async getUserPosts(
    username: string,
    dto: PaginatePostsDto,
    viewerId: string,
  ) {
    const user = await this.prisma.user.findFirst({
      where: { username, deletedAt: null },
      select: { id: true, isPrivate: true },
    });
    if (!user) throw new NotFoundException('User not found');

    if (!(await this.canViewPosts(user, viewerId))) {
      return { items: [], nextCursor: null };
    }

    const take = Math.min(
      dto.limit ?? DEFAULT_POSTS_PAGE_SIZE,
      MAX_POSTS_PAGE_SIZE,
    );

    const posts = await this.prisma.post.findMany({
      where: { userId: user.id, status: PostStatus.ACTIVE, deletedAt: null },
      take: take + 1,
      ...(dto.cursor ? { cursor: { id: dto.cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: PROFILE_POST_INCLUDE,
    });

    const hasMore = posts.length > take;
    const items = hasMore ? posts.slice(0, take) : posts;

    return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
  }

  async getUserTaggedPosts(
    username: string,
    dto: PaginatePostsDto,
    viewerId: string,
  ) {
    const user = await this.prisma.user.findFirst({
      where: { username, deletedAt: null },
      select: { id: true, isPrivate: true },
    });
    if (!user) throw new NotFoundException('User not found');

    if (!(await this.canViewPosts(user, viewerId))) {
      return { items: [], nextCursor: null };
    }

    const take = Math.min(
      dto.limit ?? DEFAULT_POSTS_PAGE_SIZE,
      MAX_POSTS_PAGE_SIZE,
    );

    const tags = await this.prisma.postUserTag.findMany({
      where: {
        userId: user.id,
        post: { status: PostStatus.ACTIVE, deletedAt: null },
      },
      take: take + 1,
      ...(dto.cursor ? { cursor: { id: dto.cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: { post: { include: PROFILE_POST_INCLUDE } },
    });

    const hasMore = tags.length > take;
    const items = hasMore ? tags.slice(0, take) : tags;

    return {
      items: items.map((t) => t.post),
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
    avatar?: Express.Multer.File,
  ) {
    const data: UserUpdateInput = {};

    if (dto.name !== undefined) data.name = dto.name;
    if (dto.bio !== undefined) data.bio = dto.bio === '' ? null : dto.bio;
    if (dto.website !== undefined)
      data.website = dto.website === '' ? null : dto.website;
    if (dto.location !== undefined)
      data.location = dto.location === '' ? null : dto.location;
    if (dto.isPrivate !== undefined) {
      const raw = dto.isPrivate as unknown;
      const normalized =
        raw === 'true' ? true : raw === 'false' ? false : (raw as boolean);
      data.isPrivate = normalized;
    }

    if (dto.username !== undefined) {
      const existing = await this.prisma.user.findFirst({
        where: { username: dto.username, id: { not: userId } },
        select: { id: true },
      });
      if (existing) throw new ConflictException('Username is already taken');
      data.username = dto.username;
    }

    if (avatar) {
      const uploaded = await this.cloudinary.uploadBuffer(
        avatar,
        `avatars/${userId}`,
      );
      data.avatarUrl = uploaded.url;
    }

    return this.prisma.user.update({
      where: { id: userId },
      data,
      omit: { passwordHash: true },
    });
  }
}
