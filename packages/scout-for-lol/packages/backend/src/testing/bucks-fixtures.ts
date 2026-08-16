import {
  DiscordAccountIdSchema,
  LeaguePuuidSchema,
  type BucksPoolParticipant,
  type DiscordAccountId,
  type LeaguePuuid,
} from "@scout-for-lol/data";

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
