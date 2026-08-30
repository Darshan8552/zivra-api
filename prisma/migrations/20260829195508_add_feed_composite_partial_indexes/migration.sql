-- H-05 Composite indexes for feed queries (bitmap heap scan fix)
-- Partial indexes use WHERE deleted_at IS NULL for soft-delete filtering; CONCURRENTLY avoids table lock.
-- Regular Prisma @@index definitions cover non-partial fallback; partial indexes are the hot-path optimization.

-- Post: userId + status + deletedAt + createdAt (feed by userId IN + status filter + soft-delete + sort)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "posts_userId_status_deletedAt_createdAt_idx" ON "posts"("user_id", "status", "deleted_at", "created_at");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "posts_status_deletedAt_createdAt_partial_idx" ON "posts"("status","deleted_at","created_at") WHERE "deleted_at" IS NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "posts_userId_status_deletedAt_createdAt_partial_idx" ON "posts"("user_id","status","deleted_at","created_at") WHERE "deleted_at" IS NULL;
-- Prisma-mapped equivalent without partial predicate (kept for compatibility with @@index):
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "posts_status_deletedAt_createdAt_idx" ON "posts"("status", "deleted_at", "created_at");

-- User: status + deletedAt + isPrivate (discovery/second-degree feed user filtering)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "users_status_deletedAt_isPrivate_idx" ON "users"("status", "deleted_at", "is_private");
-- Optimal partial variant for soft-delete filtering (commented in schema.prisma):
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "users_feed_filter_idx" ON "users"("status", "is_private") WHERE "deleted_at" IS NULL;

-- Follow: followerId + status + followingId (second-degree IN query: followerId IN (...) + status + followingId)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "follows_followerId_status_followingId_idx" ON "follows"("follower_id", "status", "following_id");
