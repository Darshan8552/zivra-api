jest.mock('../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-neon', () => ({
  PrismaNeon: jest.fn(),
}));
jest.mock('../generated/prisma/enums', () => ({
  FollowStatus: { ACCEPTED: 'ACCEPTED', PENDING: 'PENDING', REJECTED: 'REJECTED' },
  PostStatus: { ACTIVE: 'ACTIVE', ARCHIVED: 'ARCHIVED' },
}), { virtual: true });

import { Test, TestingModule } from '@nestjs/testing';
import { FeedService } from './feed.service';
import { PrismaService } from '../prisma/prisma.service';

describe('FeedService', () => {
  let service: FeedService;
  let prisma: Record<string, jest.Mock>;

  const mockPrisma = {
    follow: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
    post: { findMany: jest.fn() },
    postLike: { findMany: jest.fn() },
    bookmark: { findMany: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<FeedService>(FeedService);
    prisma = mockPrisma as any;
    // default enrich returns empty
    mockPrisma.postLike.findMany.mockResolvedValue([]);
    mockPrisma.bookmark.findMany.mockResolvedValue([]);
  });

  describe('getFollowingFeed', () => {
    it('should include viewer own posts + followings', async () => {
      mockPrisma.follow.findMany.mockResolvedValue([{ followingId: 'uB' }]);
      mockPrisma.post.findMany.mockResolvedValue([
        { id: 'p1', userId: 'uA', createdAt: new Date() },
        { id: 'p2', userId: 'uB', createdAt: new Date() },
      ]);

      const result = await service.getFollowingFeed('uA', {});

      expect(mockPrisma.follow.findMany).toHaveBeenCalledWith({
        where: { followerId: 'uA', status: 'ACCEPTED' },
        select: { followingId: true },
      });
      expect(mockPrisma.post.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: { in: ['uA', 'uB'] },
            status: 'ACTIVE',
            deletedAt: null,
            user: { status: 'ACTIVE', deletedAt: null },
          },
        }),
      );
      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBeNull();
    });

    it('should not return suspended user posts', async () => {
      mockPrisma.follow.findMany.mockResolvedValue([{ followingId: 'uB' }]);
      // Simulate DB correctly filtering out suspended user posts via user:{status:ACTIVE} — service now sends that filter
      mockPrisma.post.findMany.mockResolvedValue([{ id: 'p1', userId: 'uA', createdAt: new Date() }]);

      const result = await service.getFollowingFeed('uA', {});
      expect(mockPrisma.post.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ user: { status: 'ACTIVE', deletedAt: null } }),
        }),
      );
      expect(result.items).toHaveLength(1);
    });

    it('should paginate with cursor', async () => {
      mockPrisma.follow.findMany.mockResolvedValue([]);
      const posts = Array.from({ length: 13 }, (_, i) => ({ id: `p${i}` }));
      mockPrisma.post.findMany.mockResolvedValue(posts);

      const result = await service.getFollowingFeed('uA', { limit: 12 });

      expect(result.items).toHaveLength(12);
      expect(result.nextCursor).toBe('p11');
    });

    it('should respect cursor param', async () => {
      mockPrisma.follow.findMany.mockResolvedValue([]);
      mockPrisma.post.findMany.mockResolvedValue([{ id: 'p5' }]);

      await service.getFollowingFeed('uA', { cursor: 'p10', limit: 5 });

      expect(mockPrisma.post.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: { id: 'p10' },
          skip: 1,
        }),
      );
    });
  });

  describe('getDiscoveryFeed', () => {
    it('should filter second-degree to public only and exclude direct followings + self', async () => {
      mockPrisma.follow.findMany
        .mockResolvedValueOnce([{ followingId: 'uB' }]) // direct
        .mockResolvedValueOnce([{ followingId: 'uC' }, { followingId: 'uD' }]); // second-degree already filtered at DB (uB excluded)
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'uC' }]); // only uC public, uD private filtered
      mockPrisma.post.findMany.mockResolvedValueOnce([{ id: 'p1', userId: 'uC' }]).mockResolvedValueOnce([]); // fallback empty

      const result = await service.getDiscoveryFeed('uA', {});

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['uC', 'uD'] }, isPrivate: false, deletedAt: null, status: 'ACTIVE' },
        select: { id: true },
      });
      expect(result.items).toHaveLength(1);
    });

    it('should fallback to public trending when second-degree empty', async () => {
      mockPrisma.follow.findMany.mockResolvedValueOnce([]); // no direct followings
      mockPrisma.post.findMany.mockResolvedValueOnce([
        { id: 'pX', userId: 'uZ' },
      ]);

      const result = await service.getDiscoveryFeed('uA', { limit: 5 });

      expect(mockPrisma.post.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user: { isPrivate: false, deletedAt: null, status: 'ACTIVE' },
          }),
        }),
      );
      expect(result.items).toHaveLength(1);
    });

    it('should not fallback on paginated request (cursor set)', async () => {
      mockPrisma.follow.findMany
        .mockResolvedValueOnce([{ followingId: 'uB' }])
        .mockResolvedValueOnce([]);
      mockPrisma.post.findMany.mockResolvedValue([]);

      const result = await service.getDiscoveryFeed('uA', { cursor: 'p1' });

      // Only one post query (second-degree empty, no fallback)
      expect(mockPrisma.post.findMany).toHaveBeenCalledTimes(0); // Actually 0 because secondDegreeIds empty -> no query? Check service: if empty, skip first query
      // fallback skipped due to cursor
      expect(result.items).toHaveLength(0);
    });
  });
});
