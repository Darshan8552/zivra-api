import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseFilePipeBuilder,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { PostsService } from './posts.service';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { Public } from 'src/common/decorators/public.decorator';
import type { SafeUser } from 'src/common/types/safe-user.types';
import { CreatePostDto } from './dto/create-post.dto';
import { SearchPostsDto } from './dto/search-posts.dto';
import { memoryStorage } from 'multer';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 10;
const ALLOWED_MEDIA_TYPE_REGEX =
  /^(image\/(jpeg|png|webp|heic|heif)|video\/(mp4|quicktime|webm))$/;

@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FilesInterceptor('media', MAX_FILES, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
    }),
  )
  async create(
    @UploadedFiles(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: ALLOWED_MEDIA_TYPE_REGEX })
        .addMaxSizeValidator({ maxSize: MAX_FILE_SIZE_BYTES })
        .build({ fileIsRequired: true }),
    )
    files: Express.Multer.File[],
    @Body() dto: CreatePostDto,
    @CurrentUser() user: SafeUser,
  ) {
    return this.postsService.createPost(user.id, dto, files);
  }

  @Throttle({ search: { limit: 30, ttl: 60000 } })
  @Get('search')
  async search(@Query() dto: SearchPostsDto, @CurrentUser() user: SafeUser) {
    return this.postsService.searchPosts(dto, user.id);
  }

  @Public()
  @Get(':id')
  async findOne(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentUser() user: SafeUser,
  ) {
    return this.postsService.findOne(id, user?.id);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: SafeUser) {
    return this.postsService.remove(id, user.id);
  }
}
