import { FollowStatus, StoryVisibility } from '../generated/prisma/enums';
import { Prisma } from '../generated/prisma/client';

/**
 * Determines if a viewer can view a story based on privacy rules.
 *
 * Spec 2.2:
 * - viewerId === storyUser.id => true (self always allowed)
 * - visibility === CLOSE_FRIENDS => isCloseFriend
 * - storyUser.isPrivate => followStatus === ACCEPTED
 * - else true
 * - viewerId null (unauth) => only if !isPrivate && visibility === PUBLIC
 */
export function canViewStory(
  viewerId: string | null,
  storyUser: { id: string; isPrivate: boolean },
  visibility: StoryVisibility,
  isCloseFriend: boolean,
  followStatus: FollowStatus | null,
): boolean {
  if (viewerId !== null && viewerId === storyUser.id) return true;
  if (visibility === StoryVisibility.CLOSE_FRIENDS) return isCloseFriend;
  if (storyUser.isPrivate) return followStatus === FollowStatus.ACCEPTED;
  return true;
}

/**
 * Prisma where clause for active (non-expired) stories.
 * All reads must filter expiresAt > now().
 * Note: Story model has no deletedAt column, so we only filter expiresAt.
 */
export function activeStoriesWhere(): Prisma.StoryWhereInput {
  return { expiresAt: { gt: new Date() } };
}

// Alias for plan spec naming (getActiveStoriesWhere)
export const getActiveStoriesWhere = activeStoriesWhere;
