import { Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import type { SafeUser } from 'src/common/types/safe-user.types';
import { PaginateNotificationsDto } from './dto/paginate-notifications.dto';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async list(
    @Query() dto: PaginateNotificationsDto,
    @CurrentUser() user: SafeUser,
  ) {
    return this.notificationsService.findForUser(
      user.id,
      dto.cursor,
      dto.limit,
    );
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: SafeUser) {
    return this.notificationsService.unreadCount(user.id);
  }

  @Patch('read-all')
  async markAllRead(@CurrentUser() user: SafeUser) {
    return this.notificationsService.markAllRead(user.id);
  }

  @Patch(':id/read')
  async markRead(@Param('id') id: string, @CurrentUser() user: SafeUser) {
    return this.notificationsService.markRead(user.id, id);
  }
}
