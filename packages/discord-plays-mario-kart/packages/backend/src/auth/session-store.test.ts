// The Prisma session store: sessions live beside the leaderboard, and a session
// always resolves to the player's latest name and avatar.
import { afterEach, beforeEach, expect, test } from "vitest";
import type { PrismaClient } from "#generated/prisma/client/index.js";
import { SESSION_LIFETIME_SECONDS } from "@shepherdjerred/discord-plays-core/auth/session-store.ts";
import { openTestDatabase } from "#src/database/test-database.ts";
import { createPlayerDirectory } from "./player-directory.ts";
import { createWebSessionStore } from "./session-store.ts";

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await openTestDatabase();
});

afterEach(async () => {
  await prisma.$disconnect();
});

test("a session follows the player's current profile, until it expires", async () => {
  const players = createPlayerDirectory(prisma);
  const sessions = createWebSessionStore(prisma, players);
  const start = 5_000_000;
  const token = await sessions.create(
    { discordId: "7", username: "kart", name: "Kart", avatarUrl: null },
    start,
  );
  await players.upsert({
    discordId: "7",
    username: "kart",
    name: "Renamed",
    avatarUrl: null,
  });
  expect(await sessions.read(token, start + 1)).toMatchObject({
    name: "Renamed",
  });
  expect(
    await sessions.read(token, start + SESSION_LIFETIME_SECONDS * 1000),
  ).toBeUndefined();
});

test("signing out deletes the stored session", async () => {
  const sessions = createWebSessionStore(prisma, createPlayerDirectory(prisma));
  const token = await sessions.create({
    discordId: "8",
    username: "drift",
    name: "Drift",
    avatarUrl: null,
  });
  await sessions.delete(token);
  expect(await prisma.webSession.count()).toBe(0);
});
