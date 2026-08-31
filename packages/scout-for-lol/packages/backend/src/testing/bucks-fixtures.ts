import { afterAll, beforeEach } from "vitest";
import {
  DiscordAccountIdSchema,
  LeaguePuuidSchema,
  type BucksPoolParticipant,
  type DiscordAccountId,
  type DiscordGuildId,
  type LeaguePuuid,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";

/**
 * Shared fixtures for the Bryan Bucks integration tests.
 *
 * Extracted so the pool roster and the identifier shapes are defined once: two
 * test files independently inventing "a ten-player roster" is exactly how they
 * drift into testing different things.
 */

/** A syntactically valid 78-character PUUID, stable for a given index. */
export function bucksTestPuuid(index: number): LeaguePuuid {
  return LeaguePuuidSchema.parse(
    `p${index.toString().padStart(2, "0")}`.padEnd(78, "x"),
  );
}

/**
 * A valid Discord snowflake, stable for a given index.
 *
 * The branded schema requires at least 17 characters, so a test cannot get away
 * with `"1"` — which is precisely the kind of shortcut that makes a test pass
 * against data production would reject.
 */
export function bucksTestDiscordId(index: number): DiscordAccountId {
  return DiscordAccountIdSchema.parse(
    `1605091727047${index.toString().padStart(5, "0")}`,
  );
}

/**
 * A standard 5v5 roster snapshot: indices 0-4 on team 100, 5-9 on team 200,
 * with two tracked players on opposite sides so "A wins" and "B loses" can both
 * be exercised against one pool.
 */
export function bucksTestRoster(): BucksPoolParticipant[] {
  return Array.from({ length: 10 }, (_unused, index) => ({
    puuid: bucksTestPuuid(index),
    teamId: index < 5 ? (100 as const) : (200 as const),
    championId: 1 + index,
    riotId: `Player${index.toString()}#NA1`,
    trackedAlias: index === 0 ? "jerred" : index === 5 ? "bryan" : undefined,
  }));
}

/**
 * Input for {@link createTrackedTestPlayer}: a tracked `Player` row plus its
 * linked `Account` rows, in the shape both dare-shortlist and weekly-parlay
 * subject loading query against.
 */
export type CreateTrackedTestPlayerInput = {
  alias: string;
  serverId: DiscordGuildId;
  discordId?: DiscordAccountId;
  accounts: readonly LeaguePuuid[];
  creatorDiscordId: DiscordAccountId;
  createdAt: Date;
};

/**
 * Creates one `Player` row and its linked `Account` rows for shortlist/subject
 * integration tests.
 *
 * Extracted for the same reason as the rest of this file: `dare-shortlist`
 * and `weekly-parlay-subjects` both build their candidate list from "a
 * tracked player with N linked accounts", and two independently hand-rolled
 * copies of that seed is how the two suites drift apart.
 */
export async function createTrackedTestPlayer(
  prisma: ExtendedPrismaClient,
  input: CreateTrackedTestPlayerInput,
): Promise<number> {
  const player = await prisma.player.create({
    data: {
      alias: input.alias,
      ...(input.discordId === undefined ? {} : { discordId: input.discordId }),
      serverId: input.serverId,
      creatorDiscordId: input.creatorDiscordId,
      createdTime: input.createdAt,
      updatedTime: input.createdAt,
    },
  });
  for (const [index, puuid] of input.accounts.entries()) {
    await prisma.account.create({
      data: {
        alias: `${input.alias}-${index.toString()}`,
        puuid,
        region: "AMERICA_NORTH",
        playerId: player.id,
        serverId: input.serverId,
        creatorDiscordId: input.creatorDiscordId,
        createdTime: new Date(input.createdAt.getTime() + index * 60_000),
        updatedTime: input.createdAt,
      },
    });
  }
  return player.id;
}

/**
 * Binds {@link createTrackedTestPlayer} to one test file's creator identity
 * and fixed clock, so an integration test seeds a player in one line instead
 * of repeating `creatorDiscordId`/`createdAt` at every call site.
 */
export function trackedPlayerFactory(
  prisma: ExtendedPrismaClient,
  creatorDiscordId: DiscordAccountId,
  createdAt: Date,
): (
  input: Omit<CreateTrackedTestPlayerInput, "creatorDiscordId" | "createdAt">,
) => Promise<number> {
  return (input) =>
    createTrackedTestPlayer(prisma, { ...input, creatorDiscordId, createdAt });
}

/**
 * Registers the standard `beforeEach`/`afterAll` lifecycle for a suite that
 * seeds `Player`/`Account` rows: wipe between tests, wipe and disconnect once
 * the suite finishes. Call once per test file, right after
 * `createTestDatabase`.
 */
export function usePlayerAccountCleanup(prisma: ExtendedPrismaClient): void {
  beforeEach(async () => {
    await prisma.account.deleteMany();
    await prisma.player.deleteMany();
  });

  afterAll(async () => {
    await prisma.account.deleteMany();
    await prisma.player.deleteMany();
    await prisma.$disconnect();
  });
}
