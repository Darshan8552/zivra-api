import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CloseFriendsService } from './close-friends.service';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import type { SafeUser } from 'src/common/types/safe-user.types';
import { AddCloseFriendDto } from './dto/add-close-friend.dto';

@Controller('close-friends')
export class CloseFriendsController {
  constructor(private readonly closeFriendsService: CloseFriendsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async add(
    @CurrentUser() user: SafeUser,
    @Body() dto: AddCloseFriendDto,
  ) {
    return this.closeFriendsService.add(user.id, dto.username);
  }

  @Delete(':friendId')
  async remove(
    @CurrentUser() user: SafeUser,
    @Param('friendId', new ParseUUIDPipe({ version: '7' })) friendId: string,
  ) {
    return this.closeFriendsService.remove(user.id, friendId);
  }

  @Get()
  async list(@CurrentUser() user: SafeUser) {
    return this.closeFriendsService.list(user.id);
  }
}
