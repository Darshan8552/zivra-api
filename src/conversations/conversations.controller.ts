import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ConversationsService } from './conversations.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { PaginateConversationsDto } from './dto/paginate-conversations.dto';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import type { SafeUser } from 'src/common/types/safe-user.types';

@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateConversationDto,
    @CurrentUser() user: SafeUser,
  ) {
    return this.conversationsService.createConversation(user.id, dto);
  }

  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @Get()
  async list(
    @Query() dto: PaginateConversationsDto,
    @CurrentUser() user: SafeUser,
  ) {
    return this.conversationsService.findForUser(
      user.id,
      dto.cursor,
      dto.limit,
      dto.search,
    );
  }

  @Get(':id')
  async findOne(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentUser() user: SafeUser,
  ) {
    return this.conversationsService.findOne(user.id, id);
  }

  @Patch(':id/read')
  async markRead(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentUser() user: SafeUser,
  ) {
    return this.conversationsService.markRead(user.id, id);
  }
}
