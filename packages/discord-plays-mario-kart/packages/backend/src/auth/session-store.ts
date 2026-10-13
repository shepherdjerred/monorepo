// Signed-in browsers, persisted in the leaderboard database so sign-ins survive
// a restart and stay joined to the player's stats. The cookie carries a random
// token; only its SHA-256 is stored.
import {
  SESSION_LIFETIME_SECONDS,
  digest,
  nonce,
  type WebSessionStore,
} from "@shepherdjerred/discord-plays-core/auth/session-store.ts";
import type { PrismaClient } from "#generated/prisma/client/index.js";
import type { PlayerDirectory } from "./player-directory.ts";

export function createWebSessionStore(
  prisma: PrismaClient,
  players: PlayerDirectory,
): WebSessionStore {
  return {
    async create(user, nowMs = Date.now()) {
      const token = nonce();
      await players.upsert(user);
      await prisma.webSession.deleteMany({
        where: { expiresAt: { lte: new Date(nowMs) } },
      });
      await prisma.webSession.create({
        data: {
          tokenHash: digest(token),
          discordId: user.discordId,
          expiresAt: new Date(nowMs + SESSION_LIFETIME_SECONDS * 1000),
        },
      });
      return token;
    },
    async read(token, nowMs = Date.now()) {
      const session = await prisma.webSession.findUnique({
        where: { tokenHash: digest(token) },
      });
      const live = session !== null && session.expiresAt.getTime() > nowMs;
      return live ? players.get(session.discordId) : undefined;
    },
    async delete(token) {
      await prisma.webSession.deleteMany({
        where: { tokenHash: digest(token) },
      });
    },
  };
}
