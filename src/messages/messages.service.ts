import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { SendMessageDto } from './dto/send-message.dto';
import { MessageType } from 'src/generated/prisma/enums';
import { EventEmitter2 } from '@nestjs/event-emitter';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private async assertParticipant(userId: string, conversationId: string) {
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!participant || participant.leftAt) {
      throw new ForbiddenException('Not a participant of this conversation');
    }
    return participant;
  }

  async list(
    userId: string,
    conversationId: string,
    cursor?: string,
    limit = DEFAULT_PAGE_SIZE,
  ) {
    await this.assertParticipant(userId, conversationId);

    const take = Math.min(limit, MAX_PAGE_SIZE);

    const messages = await this.prisma.message.findMany({
      where: { conversationId, deletedAt: null },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: {
        sender: {
          select: { id: true, username: true, name: true, avatarUrl: true },
        },
        replyTo: {
          include: {
            sender: { select: { id: true, username: true, name: true } },
          },
        },
        sharedPost: { select: { id: true, caption: true } },
        sharedProfile: {
          select: { id: true, username: true, name: true, avatarUrl: true },
        },
      },
    });

    const hasMore = messages.length > take;
    const items = hasMore ? messages.slice(0, take) : messages;

    // Return in chronological order for UI (oldest first), but cursor is desc
    const chronological = [...items].reverse();

    return {
      items: chronological,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  async send(userId: string, conversationId: string, dto: SendMessageDto) {
    await this.assertParticipant(userId, conversationId);

    const type = dto.type ?? MessageType.TEXT;

    if (
      type === MessageType.TEXT &&
      (!dto.content || dto.content.trim().length === 0)
    ) {
      throw new BadRequestException('Content is required for TEXT messages');
    }

    if (dto.replyToMessageId) {
      const replyTo = await this.prisma.message.findFirst({
        where: { id: dto.replyToMessageId, conversationId, deletedAt: null },
      });
      if (!replyTo)
        throw new NotFoundException(
          'Reply target not found in this conversation',
        );
    }

    if (dto.sharedPostId) {
      const post = await this.prisma.post.findFirst({
        where: { id: dto.sharedPostId, deletedAt: null },
      });
      if (!post) throw new NotFoundException('Shared post not found');
    }

    if (dto.sharedProfileUserId) {
      const u = await this.prisma.user.findFirst({
        where: { id: dto.sharedProfileUserId, deletedAt: null },
      });
      if (!u) throw new NotFoundException('Shared profile not found');
    }

    const message = await this.prisma.message.create({
      data: {
        conversationId,
        senderId: userId,
        type,
        content: dto.content?.trim() || null,
        mediaUrl: dto.mediaUrl || null,
        mediaPublicId: dto.mediaPublicId || null,
        sharedPostId: dto.sharedPostId || null,
        sharedProfileUserId: dto.sharedProfileUserId || null,
        replyToMessageId: dto.replyToMessageId || null,
      },
      include: {
        sender: {
          select: { id: true, username: true, name: true, avatarUrl: true },
        },
        replyTo: {
          include: {
            sender: { select: { id: true, username: true, name: true } },
          },
        },
      },
    });

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    // Emit for gateway to broadcast
    this.eventEmitter.emit('message.created', {
      conversationId,
      message,
    });

    return message;
  }

  async softDelete(userId: string, messageId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });
    if (!message || message.deletedAt)
      throw new NotFoundException('Message not found');
    if (message.senderId !== userId)
      throw new ForbiddenException('Can only delete own messages');
    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date() },
    });
    this.eventEmitter.emit('message.deleted', {
      conversationId: message.conversationId,
      messageId,
    });
    return updated;
  }
}
