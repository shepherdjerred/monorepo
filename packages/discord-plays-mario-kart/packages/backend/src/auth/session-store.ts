// Signed-in browsers, persisted in the leaderboard database so sign-ins survive
// a restart. The cookie carries a random token; only its SHA-256 is stored.
import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "#generated/prisma/client/index.js";
import type { DiscordUser } from "@discord-plays-mario-kart/common";
import type { PlayerDirectory } from "./player-directory.ts";

export const SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

export function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function nonce(): string {
  return randomBytes(32).toString("base64url");
}

export type WebSessionStore = {
  /** Start a session for a user; returns the cookie token. */
  create: (user: DiscordUser, nowMs?: number) => Promise<string>;
  /** The signed-in user for a cookie token, or undefined if unknown or expired. */
  read: (token: string, nowMs?: number) => Promise<DiscordUser | undefined>;
  delete: (token: string) => Promise<void>;
};

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
