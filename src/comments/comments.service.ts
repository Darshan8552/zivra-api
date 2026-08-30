import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NotificationType } from 'src/generated/prisma/enums';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationsService } from 'src/notifications/notifications.service';

const COMMENT_INCLUDE = {
  user: {
    select: {
      id: true,
      username: true,
      name: true,
      avatarUrl: true,
      isVerified: true,
    },
  },
  _count: {
    select: {
      likes: true,
      replies: true,
    },
  },
};

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async getComments(
    postId: string,
    cursor?: string,
    limit = DEFAULT_PAGE_SIZE,
  ) {
    const take = Math.min(limit, MAX_PAGE_SIZE);

    const comments = await this.prisma.comment.findMany({
      where: {
        postId,
        parentId: null,
        deletedAt: null,
      },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'asc' },
      include: COMMENT_INCLUDE,
    });

    const hasMore = comments.length > take;
    const items = hasMore ? comments.slice(0, take) : comments;

    return {
      items,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  async getReplies(
    commentId: string,
    cursor?: string,
    limit = DEFAULT_PAGE_SIZE,
  ) {
    const take = Math.min(limit, MAX_PAGE_SIZE);

    const replies = await this.prisma.comment.findMany({
      where: {
        parentId: commentId,
        deletedAt: null,
      },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'asc' },
      include: COMMENT_INCLUDE,
    });

    const hasMore = replies.length > take;
    const items = hasMore ? replies.slice(0, take) : replies;

    return {
      items,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  async createComment(
    postId: string,
    userId: string,
    content: string,
    parentId?: string,
  ) {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, deletedAt: null },
      select: { id: true, userId: true, allowComments: true },
    });

    if (!post) throw new NotFoundException('Post not found');
    if (!post.allowComments)
      throw new ForbiddenException('Comments are disabled on this post');

    let parentComment: { id: string; userId: string } | null = null;
    if (parentId) {
      parentComment = await this.prisma.comment.findFirst({
        where: { id: parentId, postId, deletedAt: null },
        select: { id: true, userId: true },
      });
      if (!parentComment)
        throw new NotFoundException('Parent comment not found');
    }

    return this.prisma.$transaction(async (tx) => {
      const comment = await tx.comment.create({
        data: {
          postId,
          userId,
          content,
          ...(parentId ? { parentId } : {}),
        },
        include: COMMENT_INCLUDE,
      });

      if (post.userId !== userId) {
        await this.notifications.create({
          userId: post.userId,
          actorId: userId,
          type: NotificationType.COMMENT,
          entityType: 'POST',
          entityId: postId,
        });
      }

      if (parentComment && parentComment.userId !== userId) {
        await this.notifications.create({
          userId: parentComment.userId,
          actorId: userId,
          type: NotificationType.MENTION,
          entityType: 'COMMENT',
          entityId: parentComment.id,
        });
      }

      return comment;
    });
  }

  async updateComment(commentId: string, userId: string, content: string) {
    const comment = await this.prisma.comment.findFirst({
      where: { id: commentId, deletedAt: null },
      select: { id: true, userId: true },
    });

    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.userId !== userId)
      throw new ForbiddenException('You can only edit your own comments');

    return this.prisma.comment.update({
      where: { id: commentId },
      data: { content },
      include: COMMENT_INCLUDE,
    });
  }

  async deleteComment(commentId: string, userId: string) {
    const comment = await this.prisma.comment.findFirst({
      where: { id: commentId, deletedAt: null },
      select: { id: true, userId: true, postId: true },
    });

    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.userId !== userId)
      throw new ForbiddenException('You can only delete your own comments');

    await this.prisma.comment.update({
      where: { id: commentId },
      data: { deletedAt: new Date() },
    });

    return { id: commentId };
  }

  async getCommentCount(postId: string) {
    const count = await this.prisma.comment.count({
      where: { postId, deletedAt: null },
    });
    return { count };
  }
}
