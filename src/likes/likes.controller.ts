import { Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import type { SafeUser } from 'src/common/types/safe-user.types';
import { LikesService } from './likes.service';
import { PaginateCommentsDto } from 'src/comments/dto/paginate-comments.dto';

@Controller()
export class LikesController {
  constructor(private readonly likesService: LikesService) {}

  @Post('posts/:postId/like')
  async likePost(
    @Param('postId') postId: string,
    @CurrentUser() user: SafeUser,
  ) {
    return this.likesService.togglePostLike(postId, user.id);
  }

  @Delete('posts/:postId/like')
  async unlikePost(
    @Param('postId') postId: string,
    @CurrentUser() user: SafeUser,
  ) {
    return this.likesService.togglePostLike(postId, user.id);
  }

  @Post('comments/:commentId/like')
  async likeComment(
    @Param('commentId') commentId: string,
    @CurrentUser() user: SafeUser,
  ) {
    return this.likesService.toggleCommentLike(commentId, user.id);
  }

  @Delete('comments/:commentId/like')
  async unlikeComment(
    @Param('commentId') commentId: string,
    @CurrentUser() user: SafeUser,
  ) {
    return this.likesService.toggleCommentLike(commentId, user.id);
  }

  @Get('posts/:postId/likes')
  async getPostLikers(
    @Param('postId') postId: string,
    @Query() dto: PaginateCommentsDto,
  ) {
    return this.likesService.getPostLikers(postId, dto.cursor, dto.limit);
  }

  @Get('comments/:commentId/likes')
  async getCommentLikers(
    @Param('commentId') commentId: string,
    @Query() dto: PaginateCommentsDto,
  ) {
    return this.likesService.getCommentLikers(commentId, dto.cursor, dto.limit);
  }
}
