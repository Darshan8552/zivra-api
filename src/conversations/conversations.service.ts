import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { ConversationType } from 'src/generated/prisma/enums';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

const PARTICIPANT_SELECT = {
  id: true,
  userId: true,
  role: true,
  lastReadAt: true,
  joinedAt: true,
  user: {
    select: {
      id: true,
      username: true,
      name: true,
      avatarUrl: true,
      isVerified: true,
    },
  },
};

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async createConversation(creatorId: string, dto: CreateConversationDto) {
    const uniqueIds = [...new Set(dto.participantIds)].filter(
      (id) => id !== creatorId,
    );

    if (uniqueIds.length === 0) {
      throw new BadRequestException('At least one participant is required');
    }

    const type = dto.type ?? ConversationType.DIRECT;

    if (type === ConversationType.DIRECT && uniqueIds.length !== 1) {
      throw new BadRequestException(
        'DIRECT conversations require exactly one participant',
      );
    }

    if (type === ConversationType.GROUP) {
      if (!dto.title || dto.title.trim().length === 0) {
        // title optional in schema, but encourage for GROUP
      }
      if (uniqueIds.length < 2) {
        throw new BadRequestException(
          'GROUP conversations require at least 2 participants',
        );
      }
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: uniqueIds }, deletedAt: null, status: 'ACTIVE' },
      select: { id: true },
    });

    if (users.length !== uniqueIds.length) {
      throw new BadRequestException('One or more participants do not exist');
    }

    // Deduplicate DIRECT: if a DIRECT conversation already exists between these two users, return it
    if (type === ConversationType.DIRECT) {
      const otherId = uniqueIds[0];
      const existing = await this.prisma.conversation.findFirst({
        where: {
          type: ConversationType.DIRECT,
          participants: {
            every: {
              userId: { in: [creatorId, otherId] },
              leftAt: null,
            },
          },
        },
        include: {
          participants: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  name: true,
                  avatarUrl: true,
                  isVerified: true,
                },
              },
            },
          },
        },
      });

      // More precise check: must have exactly 2 participants matching
      if (existing) {
        const participantIds = existing.participants
          .map((p) => p.userId)
          .sort();
        const expected = [creatorId, otherId].sort();
        if (
          participantIds.length === 2 &&
          participantIds[0] === expected[0] &&
          participantIds[1] === expected[1]
        ) {
          return this.enrichConversation(existing, creatorId);
        }
      }
    }

    const allParticipantIds = [creatorId, ...uniqueIds];

    const conversation = await this.prisma.conversation.create({
      data: {
        type,
        title: dto.title?.trim() || null,
        createdBy: creatorId,
        participants: {
          create: allParticipantIds.map((uid) => ({
            userId: uid,
            role: uid === creatorId ? 'ADMIN' : 'MEMBER',
          })),
        },
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                name: true,
                avatarUrl: true,
                isVerified: true,
              },
            },
          },
        },
      },
    });

    return this.enrichConversation(conversation, creatorId);
  }

  async findForUser(
    userId: string,
    cursor?: string,
    limit = DEFAULT_PAGE_SIZE,
    search?: string,
  ) {
    const take = Math.min(limit, MAX_PAGE_SIZE);

    // Find conversation IDs where user is participant and not left
    const participantRows = await this.prisma.conversationParticipant.findMany({
      where: { userId, leftAt: null },
      select: { conversationId: true },
    });

    const conversationIds = participantRows.map((p) => p.conversationId);
    if (conversationIds.length === 0) {
      return { items: [], nextCursor: null };
    }

    const where: Record<string, unknown> = {
      id: { in: conversationIds },
    };

    // cursor pagination on updatedAt desc
    const conversations = await this.prisma.conversation.findMany({
      where: where as never,
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { updatedAt: 'desc' },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                name: true,
                avatarUrl: true,
                isVerified: true,
              },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          where: { deletedAt: null },
          include: {
            sender: { select: { id: true, username: true, name: true } },
          },
        },
      },
    });

    const hasMore = conversations.length > take;
    const items = hasMore ? conversations.slice(0, take) : conversations;

    let enriched = await Promise.all(
      items.map(async (conv) => this.enrichConversation(conv, userId)),
    );

    if (search?.trim()) {
      const term = search.trim().toLowerCase();
      enriched = enriched.filter((c) => {
        const titleMatch = c.title?.toLowerCase().includes(term);
        const participantMatch = c.participants.some(
          (p) =>
            p.user.name.toLowerCase().includes(term) ||
            p.user.username.toLowerCase().includes(term),
        );
        return titleMatch || participantMatch;
      });
    }

    return {
      items: enriched,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  async findOne(userId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                name: true,
                avatarUrl: true,
                isVerified: true,
              },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          where: { deletedAt: null },
          include: {
            sender: { select: { id: true, username: true, name: true } },
          },
        },
      },
    });

    if (!conversation) throw new NotFoundException('Conversation not found');

    const isParticipant = conversation.participants.some(
      (p) => p.userId === userId && !p.leftAt,
    );
    if (!isParticipant)
      throw new ForbiddenException('Not a participant of this conversation');

    return this.enrichConversation(conversation, userId);
  }

  async markRead(userId: string, conversationId: string) {
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!participant || participant.leftAt) {
      throw new ForbiddenException('Not a participant');
    }

    const updated = await this.prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { lastReadAt: new Date() },
    });

    this.eventEmitter.emit('conversation.read', {
      conversationId,
      userId,
      readAt: updated.lastReadAt,
    });

    return { success: true };
  }

  private async enrichConversation(
    conversation: Awaited<
      ReturnType<typeof this.prisma.conversation.findUnique>
    > & {
      participants: Array<{
        userId: string;
        lastReadAt: Date | null;
        leftAt: Date | null;
        user: {
          id: string;
          username: string;
          name: string;
          avatarUrl: string | null;
          isVerified: boolean;
        };
      }>;
      messages?: Array<{
        id: string;
        content: string | null;
        type: string;
        createdAt: Date;
        senderId: string;
      }>;
    } & Record<string, unknown>,
    viewerId: string,
  ) {
    if (!conversation) return conversation;

    // unreadCount: messages after lastReadAt
    const me = (
      conversation.participants as Array<{
        userId: string;
        lastReadAt: Date | null;
      }>
    ).find((p) => p.userId === viewerId);
    let unreadCount = 0;
    if (me?.lastReadAt) {
      unreadCount = await this.prisma.message.count({
        where: {
          conversationId: conversation.id,
          createdAt: { gt: me.lastReadAt },
          senderId: { not: viewerId },
          deletedAt: null,
        },
      });
    } else {
      unreadCount = await this.prisma.message.count({
        where: {
          conversationId: conversation.id,
          senderId: { not: viewerId },
          deletedAt: null,
        },
      });
    }

    const lastMessage =
      (conversation as unknown as { messages?: Array<Record<string, unknown>> })
        .messages?.[0] ?? null;

    // For DIRECT, expose other participant as title/avatar fallback
    const otherParticipant =
      (conversation.type as string) === 'DIRECT'
        ? ((
            conversation.participants as Array<{
              user: {
                name: string;
                username: string;
                avatarUrl: string | null;
              };
              userId: string;
            }>
          ).find((p) => p.userId !== viewerId)?.user ?? null)
        : null;

    return {
      ...conversation,
      unreadCount,
      lastMessage,
      otherParticipant,
    };
  }
}
