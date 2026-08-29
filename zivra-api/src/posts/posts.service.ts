import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { HashtagsService } from '../hashtags/hashtags.service';
import { CreatePostDto } from './dto/create-post.dto';
import { SearchPostsDto } from './dto/search-posts.dto';
import {
  FollowStatus,
  MediaType,
  NotificationType,
  PostStatus,
} from '../generated/prisma/enums';

const POST_INCLUDE = {
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
};

@Injectable()
export class PostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
    private readonly hashtagsService: HashtagsService,
  ) {}

  async createPost(
    userId: string,
    dto: CreatePostDto,
    files: Express.Multer.File[],
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('At least one image or video is required');
    }

    let taggedUserIds: string[] = [];
    if (dto.taggedUserIds?.length) {
      taggedUserIds = [...new Set(dto.taggedUserIds)].filter(
        (id) => id !== userId,
      );
      if (taggedUserIds.length > 0) {
        const existingUsers = await this.prisma.user.findMany({
          where: { id: { in: taggedUserIds }, deletedAt: null },
          select: { id: true },
        });
        if (existingUsers.length !== taggedUserIds.length) {
          throw new BadRequestException(
            'One or more tagged users do not exist',
          );
        }
      }
    }

    let uploaded: Awaited<ReturnType<CloudinaryService['uploadMany']>> = [];

    try {
      uploaded = await this.cloudinary.uploadMany(files, `posts/${userId}`);

      const hashtags = dto.hashtags?.length
        ? await this.hashtagsService.findOrCreateMany(dto.hashtags)
        : [];

      return await this.prisma.$transaction(async (tx) => {
        const post = await tx.post.create({
          data: {
            userId,
            caption: dto.caption,
            locationName: dto.locationName,
            latitude: dto.latitude,
            longitude: dto.longitude,
            allowComments: dto.allowComments,
            allowLikes: dto.allowLikes,
            allowShare: dto.allowShare,
            media: {
              create: uploaded.map((asset, index) => ({
                url: asset.url,
                publicId: asset.publicId,
                type:
                  asset.resourceType === 'video'
                    ? MediaType.VIDEO
                    : MediaType.IMAGE,
                order: index,
                width: asset.width,
                height: asset.height,
                duration: asset.duration,
              })),
            },
            ...(hashtags.length > 0
              ? {
                  hashtags: {
                    create: hashtags.map((h) => ({ hashtagId: h.id })),
                  },
                }
              : {}),
            ...(taggedUserIds.length > 0
              ? {
                  userTags: {
                    create: taggedUserIds.map((taggedUserId) => ({
                      userId: taggedUserId,
                    })),
                  },
                }
              : {}),
          },
          include: POST_INCLUDE,
        });

        await tx.user.update({
          where: { id: userId },
          data: { postCount: { increment: 1 } },
        });

        if (taggedUserIds.length > 0) {
          await tx.notification.createMany({
            data: taggedUserIds.map((taggedUserId) => ({
              userId: taggedUserId,
              actorId: userId,
              type: NotificationType.MENTION,
              entityType: 'POST',
              entityId: post.id,
            })),
          });
        }
        return post;
      });
    } catch (err) {
      await this.cloudinary.deleteMany(
        uploaded.map((a) => ({
          publicId: a.publicId,
          resourceType: a.resourceType,
        })),
      );
      console.error('Error creating post:', err);
      throw err;
    }
  }

  async findOne(postId: string, userId?: string) {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, deletedAt: null },
      include: POST_INCLUDE,
    });
    if (!post) throw new NotFoundException('Post not found');

    let liked = false;
    let bookmarked = false;
    if (userId) {
      const [like, bookmark] = await Promise.all([
        this.prisma.postLike.findUnique({
          where: { postId_userId: { postId, userId } },
          select: { id: true },
        }),
        this.prisma.bookmark.findUnique({
          where: { userId_postId: { userId, postId } },
          select: { id: true },
        }),
      ]);
      liked = Boolean(like);
      bookmarked = Boolean(bookmark);
    }

    return { ...post, liked, bookmarked };
  }

  async remove(postId: string, userId: string) {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, deletedAt: null },
    });
    if (!post) throw new NotFoundException('Post not found');
    if (post.userId !== userId)
      throw new ForbiddenException('You can only delete your own posts');

    await this.prisma.$transaction([
      this.prisma.post.update({
        where: { id: postId },
        data: { deletedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { postCount: { decrement: 1 } },
      }),
    ]);

    return { id: postId };
  }

  async searchPosts(dto: SearchPostsDto, viewerId: string) {
    const term = dto.q?.trim();
    const take = Math.min(dto.limit ?? 12, 50);

    // Trending fallback when q is empty: recent public posts
    if (!term) {
      const trending = await this.prisma.post.findMany({
        where: {
          status: PostStatus.ACTIVE,
          deletedAt: null,
          user: { status: 'ACTIVE', deletedAt: null, isPrivate: false },
        },
        take: take + 1,
        ...(dto.cursor ? { cursor: { id: dto.cursor }, skip: 1 } : {}),
        orderBy: { createdAt: 'desc' },
        include: POST_INCLUDE,
      });
      const hasMore = trending.length > take;
      const items = hasMore ? trending.slice(0, take) : trending;
      if (items.length === 0) return { items: [], nextCursor: null };
      // Enrich liked/bookmarked
      if (viewerId && items.length > 0) {
        const postIds = items.map((p) => p.id);
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
        const enriched = items.map((post) => ({
          ...post,
          liked: likedSet.has(post.id),
          bookmarked: bookmarkedSet.has(post.id),
        }));
        return { items: enriched, nextCursor: hasMore ? enriched[enriched.length - 1].id : null };
      }
      return {
        items: items.map((p) => ({ ...p, liked: false, bookmarked: false })),
        nextCursor: hasMore ? items[items.length - 1].id : null,
      };
    }

    const normalizedTag = term.toLowerCase().replace(/^#+/, '').trim();

    const where: Record<string, unknown> = {
      status: PostStatus.ACTIVE,
      deletedAt: null,
      user: { status: 'ACTIVE', deletedAt: null },
      OR: [
        { caption: { contains: term, mode: 'insensitive' } as const },
        ...(normalizedTag
          ? [
              {
                hashtags: {
                  some: {
                    hashtag: {
                      name: {
                        contains: normalizedTag,
                        mode: 'insensitive' as const,
                      },
                    },
                  },
                },
              },
            ]
          : []),
      ],
    };

    const posts = await this.prisma.post.findMany({
      where: where as never,
      take: take + 1,
      ...(dto.cursor ? { cursor: { id: dto.cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: {
        ...POST_INCLUDE,
        user: {
          select: {
            id: true,
            username: true,
            name: true,
            avatarUrl: true,
            isVerified: true,
            isPrivate: true,
          },
        },
      },
    });

    const hasMoreRaw = posts.length > take;
    const fetched = hasMoreRaw ? posts.slice(0, take) : posts;

    if (fetched.length === 0) {
      return { items: [], nextCursor: null };
    }

    // Privacy filter: private authors only visible to followers / self
    const authorIds = [...new Set(fetched.map((p) => p.userId))];
    const privateAuthorIds: string[] = [];
    const authorPrivateMap = new Map<string, boolean>();
    for (const p of fetched as Array<{ userId: string; user: { isPrivate: boolean } }>) {
      authorPrivateMap.set(p.userId, p.user.isPrivate);
      if (p.user.isPrivate && p.userId !== viewerId) privateAuthorIds.push(p.userId);
    }
    const uniquePrivate = [...new Set(privateAuthorIds)];
    let allowedPrivateSet = new Set<string>();
    if (uniquePrivate.length > 0) {
      const follows = await this.prisma.follow.findMany({
        where: {
          followerId: viewerId,
          followingId: { in: uniquePrivate },
          status: FollowStatus.ACCEPTED,
        },
        select: { followingId: true },
      });
      allowedPrivateSet = new Set(follows.map((f) => f.followingId));
    }

    const visible = fetched.filter((p) => {
      const isPrivate = authorPrivateMap.get(p.userId);
      if (!isPrivate) return true;
      if (p.userId === viewerId) return true;
      return allowedPrivateSet.has(p.userId);
    });

    // Enrich liked/bookmarked like findOne
    let enriched = visible as Array<Record<string, unknown> & { id: string }>;
    if (viewerId && enriched.length > 0) {
      const postIds = enriched.map((p) => p.id);
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
      enriched = enriched.map((post) => ({
        ...post,
        liked: likedSet.has(post.id),
        bookmarked: bookmarkedSet.has(post.id),
      }));
    } else {
      enriched = enriched.map((post) => ({
        ...post,
        liked: false,
        bookmarked: false,
      }));
    }

    return {
      items: enriched,
      nextCursor: hasMoreRaw && enriched.length > 0 ? enriched[enriched.length - 1].id : null,
    };
  }
}
