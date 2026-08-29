import {
  Body,
  Controller,
  Get,
  Param,
  ParseFilePipeBuilder,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { SearchUsersDto } from './dto/search-users.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { SafeUser } from '../common/types/safe-user.types';
import { UsersService } from './users.service';
import { PaginatePostsDto } from './dto/paginate-posts.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { RespondFollowDto } from './dto/respond-follow.dto';

const MAX_AVATAR_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_AVATAR_TYPE_REGEX = /^image\/(jpeg|png|webp|heic|heif)$/;

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}
  @Get('search')
  async search(@Query() dto: SearchUsersDto, @CurrentUser() user: SafeUser) {
    return this.usersService.searchUsers(dto, user.id);
  }

  @Patch('me')
  @UseInterceptors(
    FileInterceptor('avatar', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_AVATAR_SIZE_BYTES },
    }),
  )
  async updateMe(
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: ALLOWED_AVATAR_TYPE_REGEX })
        .addMaxSizeValidator({ maxSize: MAX_AVATAR_SIZE_BYTES })
        .build({ fileIsRequired: false }),
    )
    avatar: Express.Multer.File | undefined,
    @Body() dto: UpdateProfileDto,
    @CurrentUser() user: SafeUser,
  ) {
    return this.usersService.updateProfile(user.id, dto, avatar);
  }

  @Get('suggestions')
  async getSuggestions(@CurrentUser() user: SafeUser) {
    return this.usersService.getSuggestions(user.id);
  }

  @Get(':username')
  async getProfile(
    @Param('username') username: string,
    @CurrentUser() user: SafeUser,
  ) {
    return this.usersService.getPublicProfile(username, user.id);
  }

  @Post(':username/follow')
  async follow(
    @Param('username') username: string,
    @CurrentUser() user: SafeUser,
  ) {
    return this.usersService.toggleFollow(user.id, username);
  }

  @Patch('me/follow/accept')
  async acceptFollowRequestMe(
    @Body() body: RespondFollowDto,
    @CurrentUser() user: SafeUser,
  ) {
    return this.usersService.respondToFollowRequest(
      user.id,
      body.actorId,
      true,
    );
  }

  @Patch('me/follow/decline')
  async declineFollowRequestMe(
    @Body() body: RespondFollowDto,
    @CurrentUser() user: SafeUser,
  ) {
    return this.usersService.respondToFollowRequest(
      user.id,
      body.actorId,
      false,
    );
  }

  @Get(':username/posts')
  async getPosts(
    @Param('username') username: string,
    @Query() dto: PaginatePostsDto,
    @CurrentUser() user: SafeUser,
  ) {
    return this.usersService.getUserPosts(username, dto, user.id);
  }

  @Get(':username/followers')
  async getFollowers(
    @Param('username') username: string,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentUser() user: SafeUser,
  ) {
    return this.usersService.getUserFollowers(
      username,
      user.id,
      cursor,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  @Get(':username/following')
  async getFollowing(
    @Param('username') username: string,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentUser() user: SafeUser,
  ) {
    return this.usersService.getUserFollowing(
      username,
      user.id,
      cursor,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  @Get(':username/tagged-posts')
  async getTaggedPosts(
    @Param('username') username: string,
    @Query() dto: PaginatePostsDto,
    @CurrentUser() user: SafeUser,
  ) {
    return this.usersService.getUserTaggedPosts(username, dto, user.id);
  }
}
