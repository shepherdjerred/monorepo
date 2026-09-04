import type { DiscordAccountId } from "@scout-for-lol/data";
import type { User } from "#generated/prisma/client/index.js";

export function createTestUser(discordId: DiscordAccountId): User {
  return {
    discordId,
    discordUsername: "Test Admin",
    discordAvatar: null,
    discordAccessToken: "access",
    discordRefreshToken: "refresh",
    tokenExpiresAt: null,
    analyticsUserId: `analytics-${discordId}`,
    lastSeenAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}
