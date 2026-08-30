import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NotificationType } from 'src/generated/prisma/enums';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationsService } from 'src/notifications/notifications.service';

const LIKER_SELECT = {
  id: true,
  username: true,
  name: true,
  avatarUrl: true,
  isVerified: true,
};

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

@Injectable()
export class LikesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async togglePostLike(postId: string, userId: string) {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, deletedAt: null },
      select: { id: true, userId: true, allowLikes: true },
    });

    if (!post) throw new NotFoundException('Post not found');
    if (!post.allowLikes)
      throw new ForbiddenException('Likes are disabled on this post');

    const existing = await this.prisma.postLike.findUnique({
      where: { postId_userId: { postId, userId } },
    });

    if (existing) {
      await this.prisma.postLike.delete({ where: { id: existing.id } });
      return { liked: false, postId };
    }

    await this.prisma.postLike.create({ data: { postId, userId } });

    if (post.userId !== userId) {
      await this.notifications.create({
        userId: post.userId,
        actorId: userId,
        type: NotificationType.LIKE,
        entityType: 'POST',
        entityId: postId,
      });
    }

    return { liked: true, postId };
  }

  async toggleCommentLike(commentId: string, userId: string) {
    const comment = await this.prisma.comment.findFirst({
      where: { id: commentId, deletedAt: null },
      select: {
        id: true,
        userId: true,
        post: { select: { allowLikes: true } },
      },
    });

    if (!comment) throw new NotFoundException('Comment not found');
    if (!comment.post.allowLikes)
      throw new ForbiddenException('Likes are disabled on this post');

    const existing = await this.prisma.commentLike.findUnique({
      where: { commentId_userId: { commentId, userId } },
    });

    if (existing) {
      await this.prisma.commentLike.delete({ where: { id: existing.id } });
      return { liked: false, commentId };
    }

    await this.prisma.commentLike.create({ data: { commentId, userId } });

    if (comment.userId !== userId) {
      await this.notifications.create({
        userId: comment.userId,
        actorId: userId,
        type: NotificationType.LIKE,
        entityType: 'COMMENT',
        entityId: commentId,
      });
    }

    return { liked: true, commentId };
  }

  async getPostLikers(
    postId: string,
    cursor?: string,
    limit = DEFAULT_PAGE_SIZE,
  ) {
    const take = Math.min(limit, MAX_PAGE_SIZE);

    const likes = await this.prisma.postLike.findMany({
      where: { postId },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: { user: { select: LIKER_SELECT } },
    });

    const hasMore = likes.length > take;
    const items = hasMore ? likes.slice(0, take) : likes;

    return {
      items: items.map((like) => like.user),
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  async getCommentLikers(
    commentId: string,
    cursor?: string,
    limit = DEFAULT_PAGE_SIZE,
  ) {
    const take = Math.min(limit, MAX_PAGE_SIZE);

    const likes = await this.prisma.commentLike.findMany({
      where: { commentId },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: { user: { select: LIKER_SELECT } },
    });

    const hasMore = likes.length > take;
    const items = hasMore ? likes.slice(0, take) : likes;

    return {
      items: items.map((like) => like.user),
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }
}
