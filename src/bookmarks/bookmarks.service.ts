import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

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

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

@Injectable()
export class BookmarksService {
  constructor(private readonly prisma: PrismaService) {}

  async toggleBookmark(postId: string, userId: string) {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, deletedAt: null },
      select: { id: true },
    });

    if (!post) throw new NotFoundException('Post not found');

    const existing = await this.prisma.bookmark.findUnique({
      where: { userId_postId: { userId, postId } },
    });

    if (existing) {
      await this.prisma.bookmark.delete({ where: { id: existing.id } });
      return { bookmarked: false, postId };
    }

    await this.prisma.bookmark.create({ data: { postId, userId } });
    return { bookmarked: true, postId };
  }

  async getUserBookmarks(
    userId: string,
    cursor?: string,
    limit = DEFAULT_PAGE_SIZE,
  ) {
    const take = Math.min(limit, MAX_PAGE_SIZE);

    const bookmarks = await this.prisma.bookmark.findMany({
      where: { userId },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: { post: { include: POST_INCLUDE } },
    });

    const hasMore = bookmarks.length > take;
    const items = hasMore ? bookmarks.slice(0, take) : bookmarks;

    return {
      items: items.map((b) => b.post),
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  async isBookmarked(postId: string, userId: string) {
    const bookmark = await this.prisma.bookmark.findUnique({
      where: { userId_postId: { userId, postId } },
      select: { id: true },
    });
    return { bookmarked: Boolean(bookmark), postId };
  }
}
