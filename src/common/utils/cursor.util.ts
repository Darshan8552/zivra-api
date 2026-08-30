import { BadRequestException } from '@nestjs/common';

export interface FeedCursor {
  createdAt: Date;
  id: string;
}

const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function encodeFeedCursor(cursor: {
  createdAt: Date | string;
  id: string;
}): string {
  const createdAt =
    cursor.createdAt instanceof Date
      ? cursor.createdAt.toISOString()
      : cursor.createdAt;
  const payload = JSON.stringify({ createdAt, id: cursor.id });
  return Buffer.from(payload, 'utf-8').toString('base64url');
}

export function decodeFeedCursor(cursor: string): FeedCursor {
  if (!cursor || typeof cursor !== 'string') {
    throw new BadRequestException('Invalid cursor');
  }

  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf-8');
    const parsed = JSON.parse(json) as { createdAt?: string; id?: string };
    if (parsed?.createdAt && parsed?.id) {
      const date = new Date(parsed.createdAt);
      if (!Number.isNaN(date.getTime()) && typeof parsed.id === 'string') {
        if (UUID_V7_RE.test(parsed.id)) {
          return { createdAt: date, id: parsed.id };
        }
      }
    }
  } catch {}

  throw new BadRequestException('Invalid cursor');
}

export function isUuidV7(value: string): boolean {
  return UUID_V7_RE.test(value);
}
