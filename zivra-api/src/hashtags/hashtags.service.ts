import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Hashtag } from '../generated/prisma/client';

const HASHTAG_NAME_REGEX = /^[a-z0-9_]{1,50}$/;
const DEFAULT_SUGGESTION_LIMIT = 5;
const MAX_SUGGESTION_LIMIT = 50;

@Injectable()
export class HashtagsService {
  constructor(private readonly prisma: PrismaService) {}

  normalize(raw: string): string {
    return raw.trim().toLowerCase().replace(/^#+/, '');
  }

  async suggestions(
    query: string | undefined,
    limit = DEFAULT_SUGGESTION_LIMIT,
  ) {
    const take = Math.min(Math.max(limit, 1), MAX_SUGGESTION_LIMIT);
    const normalized = query ? this.normalize(query) : '';
    const hashtags = await this.prisma.hashtag.findMany({
      where: normalized ? { name: { startsWith: normalized } } : undefined,
      take,
      orderBy: { posts: { _count: 'desc' } },
      select: { id: true, name: true, _count: { select: { posts: true } } },
    });

    return hashtags.map((h) => ({
      id: h.id,
      name: h.name,
      postCount: h._count.posts,
    }));
  }

  async findOrCreateMany(rawNames: string[]): Promise<Hashtag[]> {
    const names = [
      ...new Set(rawNames.map((n) => this.normalize(n)).filter(Boolean)),
    ];

    if (names.length === 0) return [];

    const invalid = names.filter((n) => !HASHTAG_NAME_REGEX.test(n));
    if (invalid.length > 0) {
      throw new BadRequestException(
        `Invalid hashtags: ${invalid.join(', ')}. Use only letters, numbers and underscores.`,
      );
    }

    return this.prisma.$transaction(
      names.map((name) =>
        this.prisma.hashtag.upsert({
          where: { name },
          update: {},
          create: { name },
        }),
      ),
    );
  }
}
