import { Injectable } from '@nestjs/common';
import { FollowStatus, NotificationType } from 'src/generated/prisma/enums';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationsGateway } from './notifications.gateway';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface CreateNotificationInput {
  userId: string;
  actorId?: string;
  type: NotificationType;
  entityType?: string;
  entityId?: string;
  message?: string;
}

const ACTOR_SELECT = {
  id: true,
  username: true,
  name: true,
  avatarUrl: true,
  isVerified: true,
};

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(input: CreateNotificationInput) {
    if (input.actorId && input.actorId === input.userId) return null;

    const notification = await this.prisma.notification.create({
      data: input,
      include: { actor: { select: ACTOR_SELECT } },
    });

    this.eventEmitter.emit('notification.created', notification);
    return notification;
  }

  async findForUser(
    userId: string,
    cursor?: string,
    limit = DEFAULT_PAGE_SIZE,
  ) {
    const take = Math.min(limit, MAX_PAGE_SIZE);

    const notifications = await this.prisma.notification.findMany({
      where: { userId },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: { actor: { select: ACTOR_SELECT } },
    });

    const hasMore = notifications.length > take;
    const items = hasMore ? notifications.slice(0, take) : notifications;

    const actorIds = items
      .map((n) => n.actorId)
      .filter((id): id is string => Boolean(id) && id !== userId);

    const followingSet = new Set<string>();
    const pendingRequestSet = new Set<string>();
    if (actorIds.length > 0) {
      const outgoing = await this.prisma.follow.findMany({
        where: {
          followerId: userId,
          followingId: { in: actorIds },
          status: FollowStatus.ACCEPTED,
        },
        select: { followingId: true },
      });
      outgoing.forEach((f) => followingSet.add(f.followingId));

      const incomingPending = await this.prisma.follow.findMany({
        where: {
          followingId: userId,
          followerId: { in: actorIds },
          status: FollowStatus.PENDING,
        },
        select: { followerId: true },
      });
      incomingPending.forEach((f) => pendingRequestSet.add(f.followerId));
    }

    const enriched = items.map((n) => ({
      ...n,
      isFollowingActor: n.actorId ? followingSet.has(n.actorId) : false,
      isFollowRequestPending: n.actorId
        ? pendingRequestSet.has(n.actorId)
        : false,
    }));

    return {
      items: enriched,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  async unreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: { userId, isRead: false },
    });
    return { count };
  }

  async markRead(userId: string, notificationId: string) {
    await this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true },
    });
    this.eventEmitter.emit('notification.read', { userId, notificationId });
    return { id: notificationId };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    this.eventEmitter.emit('notification.all_read', { userId });
    return { success: true };
  }
}
