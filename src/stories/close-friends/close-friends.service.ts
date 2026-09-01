import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const MAX_CLOSE_FRIENDS = 50;

@Injectable()
export class CloseFriendsService {
  constructor(private readonly prisma: PrismaService) {}

  async add(userId: string, friendUsername: string) {
    const friend = await this.prisma.user.findFirst({
      where: { username: friendUsername, deletedAt: null },
      select: { id: true, username: true },
    });
    if (!friend) {
      throw new NotFoundException('User not found');
    }
    if (friend.id === userId) {
      throw new BadRequestException('You cannot add yourself as close friend');
    }

    const count = await this.prisma.closeFriend.count({
      where: { userId },
    });
    if (count >= MAX_CLOSE_FRIENDS) {
      throw new BadRequestException(
        `Close friends limit reached (max ${MAX_CLOSE_FRIENDS})`,
      );
    }

    const existing = await this.prisma.closeFriend.findUnique({
      where: { userId_friendId: { userId, friendId: friend.id } },
    });
    if (existing) {
      throw new BadRequestException('Already in close friends');
    }

    return this.prisma.closeFriend.create({
      data: { userId, friendId: friend.id },
      include: { friend: true },
    });
  }

  async remove(userId: string, friendId: string) {
    const existing = await this.prisma.closeFriend.findUnique({
      where: { userId_friendId: { userId, friendId } },
    });
    if (!existing) {
      throw new NotFoundException('Close friend not found');
    }
    return this.prisma.closeFriend.delete({
      where: { userId_friendId: { userId, friendId } },
    });
  }

  async list(userId: string) {
    return this.prisma.closeFriend.findMany({
      where: { userId },
      include: { friend: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
