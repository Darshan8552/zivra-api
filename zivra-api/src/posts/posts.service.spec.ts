jest.mock('../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-neon', () => ({
  PrismaNeon: jest.fn(),
}));
jest.mock('../generated/prisma/enums', () => ({
  FollowStatus: { ACCEPTED: 'ACCEPTED', PENDING: 'PENDING', REJECTED: 'REJECTED' },
  PostStatus: { ACTIVE: 'ACTIVE', ARCHIVED: 'ARCHIVED' },
  MediaType: { IMAGE: 'IMAGE', VIDEO: 'VIDEO' },
  NotificationType: { MENTION: 'MENTION' },
}), { virtual: true });

import { Test } from '@nestjs/testing';
import { PostsService } from './posts.service';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { HashtagsService } from '../hashtags/hashtags.service';

describe('PostsService.searchPosts', () => {
  let service: PostsService;
  const mockPrisma: any = {
    post: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
    follow: { findMany: jest.fn() },
    postLike: { findMany: jest.fn() },
    bookmark: { findMany: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.postLike.findMany.mockResolvedValue([]);
    mockPrisma.bookmark.findMany.mockResolvedValue([]);
    mockPrisma.user.findMany.mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        PostsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CloudinaryService, useValue: { uploadMany: jest.fn(), deleteMany: jest.fn() } },
        { provide: HashtagsService, useValue: { findOrCreateMany: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(PostsService);
  });

  test('returns empty for empty q', async () => {
    const result = await service.searchPosts({ q: '   ' } as any, 'viewer');
    expect(result).toEqual({ items: [], nextCursor: null });
    expect(mockPrisma.post.findMany).not.toHaveBeenCalled();
  });

  test('filters private author not followed', async () => {
    mockPrisma.post.findMany.mockResolvedValue([
      { id: 'p1', userId: 'privateUser', caption: 'blue', user: { id: 'privateUser', isPrivate: true, username: 'u' } },
      { id: 'p2', userId: 'publicUser', caption: 'blue sky', user: { id: 'publicUser', isPrivate: false, username: 'v' } },
    ]);
    mockPrisma.follow.findMany.mockResolvedValue([]); // not following privateUser
    mockPrisma.user.findMany.mockResolvedValue([]); // not used

    const result = await service.searchPosts({ q: 'blue', limit: 10 } as any, 'viewer');

    // Should have filtered out p1
    expect(result.items.length).toBe(1);
    expect(result.items[0].id).toBe('p2');
  });

  test('allows private author when followed', async () => {
    mockPrisma.post.findMany.mockResolvedValue([
      { id: 'p1', userId: 'privateUser', caption: 'blue', user: { id: 'privateUser', isPrivate: true } },
    ]);
    mockPrisma.follow.findMany.mockResolvedValue([{ followingId: 'privateUser' }]);
    mockPrisma.user.findMany.mockResolvedValue([]);

    const result = await service.searchPosts({ q: 'blue' } as any, 'viewer');
    expect(result.items.length).toBe(1);
  });

  test('allows own private post', async () => {
    mockPrisma.post.findMany.mockResolvedValue([
      { id: 'p1', userId: 'viewer', caption: 'blue', user: { id: 'viewer', isPrivate: true } },
    ]);
    // follow not needed for self
    mockPrisma.follow.findMany.mockResolvedValue([]);

    const result = await service.searchPosts({ q: 'blue' } as any, 'viewer');
    expect(result.items.length).toBe(1);
  });

  test('paginates with cursor', async () => {
    mockPrisma.post.findMany.mockResolvedValue([
      { id: 'p1', userId: 'u1', caption: 'a', user: { id: 'u1', isPrivate: false } },
    ]);
    await service.searchPosts({ q: 'a', cursor: '01234567-89ab-7def-8123-456789abcdef', limit: 5 } as any, 'viewer');
    expect(mockPrisma.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: '01234567-89ab-7def-8123-456789abcdef' }, skip: 1 }),
    );
  });
});
