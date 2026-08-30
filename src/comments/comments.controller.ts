import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import type { SafeUser } from 'src/common/types/safe-user.types';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { PaginateCommentsDto } from './dto/paginate-comments.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';

@Controller()
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Get('posts/:postId/comments')
  async getComments(
    @Param('postId') postId: string,
    @Query() dto: PaginateCommentsDto,
  ) {
    return this.commentsService.getComments(postId, dto.cursor, dto.limit);
  }

  @Post('posts/:postId/comments')
  async createComment(
    @Param('postId') postId: string,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: SafeUser,
  ) {
    return this.commentsService.createComment(
      postId,
      user.id,
      dto.content,
      dto.parentId,
    );
  }

  @Get('comments/:commentId/replies')
  async getReplies(
    @Param('commentId') commentId: string,
    @Query() dto: PaginateCommentsDto,
  ) {
    return this.commentsService.getReplies(commentId, dto.cursor, dto.limit);
  }

  @Patch('comments/:commentId')
  async updateComment(
    @Param('commentId') commentId: string,
    @Body() dto: UpdateCommentDto,
    @CurrentUser() user: SafeUser,
  ) {
    return this.commentsService.updateComment(commentId, user.id, dto.content);
  }

  @Delete('comments/:commentId')
  async deleteComment(
    @Param('commentId') commentId: string,
    @CurrentUser() user: SafeUser,
  ) {
    return this.commentsService.deleteComment(commentId, user.id);
  }

  @Get('posts/:postId/comment-count')
  async getCommentCount(@Param('postId') postId: string) {
    return this.commentsService.getCommentCount(postId);
  }
}
