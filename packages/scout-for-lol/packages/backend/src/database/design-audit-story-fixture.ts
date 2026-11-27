import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import {
  LeaguePuuidSchema,
  type DiscordAccountId,
  type LeaguePuuid,
} from "@scout-for-lol/data";
import type { PrismaClient } from "#generated/prisma/client/index.js";
import { storyMatchFixture } from "#src/testing/report-lake/story-match-fixture.ts";

/**
 * The Match page's audit game: a ranked Summoner's Rift win with a 28-minute
 * timeline, played by the audit player with two tracked friends on the team.
 */
export const DESIGN_AUDIT_STORY_MATCH_ID =
  RiotMatchIdSchema.parse("NA1_9500000001");

const CREATED_AT = new Date("2026-01-01T09:00:00.000Z");
/** The story's blue bot and support seats are tracked friends. */
const FRIEND_SEATS = new Map([
  [4, "r"],
  [5, "s"],
]);

function puuidFor(participantId: number): LeaguePuuid {
  const friend = FRIEND_SEATS.get(participantId);
  return LeaguePuuidSchema.parse(
    (friend === undefined
      ? `story-${participantId.toString()}`
      : `friend-${friend}`
    ).padEnd(78, "x"),
  );
}

/** The lake rows for the story game, with the viewer as the audit player. */
export function designAuditStoryGame(viewer: {
  playerId: number;
  alias: string;
  puuid: LeaguePuuid;
  discordId: DiscordAccountId;
}) {
  const story = storyMatchFixture({
    matchId: DESIGN_AUDIT_STORY_MATCH_ID,
    gameCreationAt: CREATED_AT,
    viewer: {
      playerId: viewer.playerId,
      playerAlias: viewer.alias,
      puuid: viewer.puuid,
    },
    puuidOf: puuidFor,
  });
  return {
    ...story,
    matchFacts: story.matchFacts.map((fact) => ({
      ...fact,
      discordId: viewer.discordId,
    })),
  };
}

/** The ranked snapshots that give the story game its LP change. */
export async function seedDesignAuditStoryRank(input: {
  prisma: PrismaClient;
  puuid: LeaguePuuid;
  now: Date;
}) {
  await input.prisma.matchRankHistory.create({
    data: {
      matchId: DESIGN_AUDIT_STORY_MATCH_ID,
      puuid: input.puuid,
      queueType: "solo",
      rankBefore: JSON.stringify({
        tier: "emerald",
        division: 2,
        lp: 43,
        wins: 40,
        losses: 35,
      }),
      rankAfter: JSON.stringify({
        tier: "emerald",
        division: 2,
        lp: 64,
        wins: 41,
        losses: 35,
      }),
      matchGameCreationAt: CREATED_AT,
      matchGameEndAt: new Date(CREATED_AT.getTime() + 28 * 60_000),
      capturedAt: input.now,
    },
  });
}
