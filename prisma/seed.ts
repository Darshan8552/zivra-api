import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import * as bcrypt from 'bcryptjs';

async function createClient(): Promise<PrismaClient> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for seeding');
  }
  const adapter = new PrismaNeon({ connectionString });
  return new PrismaClient({ adapter });
}

async function main() {
  const prisma = await createClient();

  try {
    const demoEmail = 'demo@zivra.app';
    const demoUsername = 'zivra_demo';

    let user = await prisma.user.findFirst({
      where: { OR: [{ email: demoEmail }, { username: demoUsername }] },
    });

    if (!user) {
      const passwordHash = await bcrypt.hash('ZivraDemo123!', 12);
      user = await prisma.user.create({
        data: {
          email: demoEmail,
          username: demoUsername,
          passwordHash,
          name: 'Zivra Demo',
          bio: 'Demo account seeded by prisma/seed.ts',
          isPrivate: false,
          isVerified: true,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
        },
      });
      console.log(`Seed: created demo user ${user.username} (${user.id})`);
    } else {
      console.log(`Seed: demo user already exists ${user.username} (${user.id})`);
    }

    // Ensure a second private user for canViewPosts testing
    const privateEmail = 'private_demo@zivra.app';
    const privateUsername = 'zivra_private';
    let privateUser = await prisma.user.findFirst({
      where: { OR: [{ email: privateEmail }, { username: privateUsername }] },
    });
    if (!privateUser) {
      const passwordHash = await bcrypt.hash('ZivraDemo123!', 12);
      privateUser = await prisma.user.create({
        data: {
          email: privateEmail,
          username: privateUsername,
          passwordHash,
          name: 'Zivra Private',
          bio: 'Private demo account',
          isPrivate: true,
          isVerified: false,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
        },
      });
      console.log(`Seed: created private demo user ${privateUser.username}`);
    } else {
      console.log(`Seed: private demo user already exists ${privateUser.username}`);
    }

    // Idempotent post: check existing active post for demo user before creating
    const existingPost = await prisma.post.findFirst({
      where: { userId: user.id, status: 'ACTIVE', deletedAt: null },
    });

    if (!existingPost) {
      const post = await prisma.post.create({
        data: {
          userId: user.id,
          caption: 'Welcome to Zivra! This is a seeded demo post. #zivra #demo',
          allowComments: true,
          allowLikes: true,
          allowShare: true,
          status: 'ACTIVE',
          media: {
            create: [
              {
                url: 'https://res.cloudinary.com/demo/image/upload/v1/zivra/seed-demo.jpg',
                publicId: 'zivra/seed-demo',
                type: 'IMAGE',
                order: 0,
                width: 1080,
                height: 1080,
              },
            ],
          },
        },
        include: { media: true },
      });
      console.log(`Seed: created demo post ${post.id} for ${user.username}`);
    } else {
      console.log(`Seed: demo post already exists ${existingPost.id}`);
    }

    // Optional: follow relationship demo -> private not yet accepted (to test pending)
    // Keep idempotent — only if no row exists
    const existingFollow = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: user.id,
          followingId: privateUser.id,
        },
      },
    });
    if (!existingFollow) {
      console.log('Seed: no follow between demo users (leave empty for tests)');
    }

    console.log('Seed completed.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('Seed failed:', e);
  process.exit(1);
});
