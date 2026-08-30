import { Module } from '@nestjs/common';
import { PostsService } from './posts.service';
import { PostsController } from './posts.controller';
import { HashtagsModule } from '../hashtags/hashtags.module';

@Module({
  imports: [HashtagsModule],
  controllers: [PostsController],
  providers: [PostsService],
})
export class PostsModule {}
