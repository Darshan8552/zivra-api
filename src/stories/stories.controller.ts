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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { StoriesService } from './stories.service';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { Public } from 'src/common/decorators/public.decorator';
import type { SafeUser } from 'src/common/types/safe-user.types';
import { StoryFeedQueryDto } from './dto/story-feed-query.dto';
import { StoryVisibility } from 'src/generated/prisma/enums';

const MAX_STORY_SIZE_BYTES = 30 * 1024 * 1024;
const ALLOWED_MEDIA_TYPE_REGEX =
  /^(image\/(jpeg|png|webp|heic|heif)|video\/(mp4|quicktime|webm))$/;

@Controller('stories')
export class StoriesController {
  constructor(private readonly storiesService: StoriesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('media', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_STORY_SIZE_BYTES },
    }),
  )
  async create(
    @CurrentUser() user: SafeUser,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: ALLOWED_MEDIA_TYPE_REGEX })
        .addMaxSizeValidator({ maxSize: MAX_STORY_SIZE_BYTES })
        .build({ fileIsRequired: true }),
    )
    file: Express.Multer.File,
    @Body('visibility') visibility?: StoryVisibility,
  ) {
    return this.storiesService.create(user.id, file, visibility ?? StoryVisibility.PUBLIC);
  }

  @Public()
  @Get('feed')
  async feed(
    @CurrentUser() user: SafeUser,
    @Query() q: StoryFeedQueryDto,
  ) {
    return this.storiesService.getFeed(user?.id ?? null, q.cursor, q.limit);
  }

  @Public()
  @Get('users/:username')
  async userStories(
    @Param('username') username: string,
    @CurrentUser() user: SafeUser,
  ) {
    return this.storiesService.getUserStories(username, user?.id ?? null);
  }

  @Post(':id/view')
  @HttpCode(HttpStatus.CREATED)
  async view(
    @CurrentUser() user: SafeUser,
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
  ) {
    return this.storiesService.markViewed(user.id, id);
  }

  @Delete(':id')
  async del(
    @CurrentUser() user: SafeUser,
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
  ) {
    return this.storiesService.delete(user.id, id);
  }
}
