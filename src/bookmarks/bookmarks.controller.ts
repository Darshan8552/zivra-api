import { Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import type { SafeUser } from 'src/common/types/safe-user.types';
import { BookmarksService } from './bookmarks.service';
import { PaginateCommentsDto } from 'src/comments/dto/paginate-comments.dto';

@Controller()
export class BookmarksController {
  constructor(private readonly bookmarksService: BookmarksService) {}

  @Post('posts/:postId/bookmark')
  async bookmarkPost(
    @Param('postId') postId: string,
    @CurrentUser() user: SafeUser,
  ) {
    return this.bookmarksService.toggleBookmark(postId, user.id);
  }

  @Delete('posts/:postId/bookmark')
  async unbookmarkPost(
    @Param('postId') postId: string,
    @CurrentUser() user: SafeUser,
  ) {
    return this.bookmarksService.toggleBookmark(postId, user.id);
  }

  @Get('bookmarks')
  async getUserBookmarks(
    @CurrentUser() user: SafeUser,
    @Query() dto: PaginateCommentsDto,
  ) {
    return this.bookmarksService.getUserBookmarks(
      user.id,
      dto.cursor,
      dto.limit,
    );
  }

  @Get('posts/:postId/bookmark')
  async isBookmarked(
    @Param('postId') postId: string,
    @CurrentUser() user: SafeUser,
  ) {
    return this.bookmarksService.isBookmarked(postId, user.id);
  }
}
