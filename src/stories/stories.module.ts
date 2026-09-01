import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { StoriesService } from './stories.service';
import { CloseFriendsService } from './close-friends/close-friends.service';
import { StoriesController } from './stories.controller';
import { CloseFriendsController } from './close-friends/close-friends.controller';

@Module({
  imports: [PrismaModule, CloudinaryModule],
  controllers: [StoriesController, CloseFriendsController],
  providers: [StoriesService, CloseFriendsService],
  exports: [StoriesService, CloseFriendsService],
})
export class StoriesModule {}
