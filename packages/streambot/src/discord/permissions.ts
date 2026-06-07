import type { UserId } from "@shepherdjerred/streambot/types/ids.ts";

/** True if the user is a configured admin. */
export function isAdmin(userId: UserId, adminIds: readonly UserId[]): boolean {
  return adminIds.includes(userId);
}

/** True if the user may skip/remove the given requester's item (admin, or the original requester). */
export function canControlItem(
  userId: UserId,
  requesterId: UserId | null,
  adminIds: readonly UserId[],
): boolean {
  return (
    isAdmin(userId, adminIds) ||
    (requesterId !== null && requesterId === userId)
  );
}
