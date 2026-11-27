import { wasPromoted, type LeaguePuuid, type Rank } from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import {
  lpDeltaBetween,
  parseSnapshot,
} from "#src/trpc/router/consumer/match-lp-delta.ts";
import type { HomePerson } from "#src/trpc/router/consumer/home/home-people.ts";

/** One ranked game's change on a ladder, as `MatchRankHistory` captured it. */
export type RankMove = {
  puuid: LeaguePuuid;
  at: number;
  queue: "solo" | "flex";
  /** `null` where the snapshots state no difference (placements, apex). */
  lpDelta: number | null;
  promotedTo: Rank | null;
};

/**
 * Every Solo/Duo and Flex rank change since `sinceMs` for these accounts. Read
 * from Postgres alone; nothing is estimated where a snapshot is missing.
 */
export async function readRankMoves(input: {
  puuids: readonly LeaguePuuid[];
  sinceMs: number;
}): Promise<RankMove[]> {
  if (input.puuids.length === 0) return [];
  const since = new Date(input.sinceMs);
  const rows = await prisma.matchRankHistory.findMany({
    where: {
      puuid: { in: [...input.puuids] },
      queueType: { in: ["solo", "flex"] },
      rankAfter: { not: null },
      OR: [
        { matchGameEndAt: { gte: since } },
        { matchGameEndAt: null, capturedAt: { gte: since } },
      ],
    },
    select: {
      puuid: true,
      queueType: true,
      rankBefore: true,
      rankAfter: true,
      matchGameEndAt: true,
      capturedAt: true,
    },
  });
  return rows.flatMap((row) => {
    const after = parseSnapshot(row.rankAfter);
    if (after === null) return [];
    if (row.queueType !== "solo" && row.queueType !== "flex") return [];
    const before = parseSnapshot(row.rankBefore);
    return [
      {
        puuid: row.puuid,
        at: (row.matchGameEndAt ?? row.capturedAt).getTime(),
        queue: row.queueType,
        lpDelta: lpDeltaBetween(before, after),
        promotedTo:
          before !== null && wasPromoted(before, after) ? after : null,
      },
    ];
  });
}

export type HomeClimber = {
  playerId: number;
  alias: string;
  isYou: boolean;
  /** Solo/Duo LP gained over the week; only positive totals are listed. */
  lpDelta: number;
};

export const HOME_CLIMBERS = 3;

/**
 * Solo/Duo LP over the week, by person, biggest gain first. A person with two
 * accounts adds them up; a game with no stated difference adds nothing.
 */
export function buildClimbers(
  people: readonly HomePerson[],
  moves: readonly RankMove[],
): HomeClimber[] {
  const owner = new Map<LeaguePuuid, HomePerson>();
  for (const person of people) {
    for (const puuid of person.puuids) owner.set(puuid, person);
  }
  const totals = new Map<number, number>();
  for (const move of moves) {
    const person = owner.get(move.puuid);
    if (
      person === undefined ||
      move.queue !== "solo" ||
      move.lpDelta === null
    ) {
      continue;
    }
    totals.set(
      person.playerId,
      (totals.get(person.playerId) ?? 0) + move.lpDelta,
    );
  }
  return people
    .flatMap((person) => {
      const lpDelta = totals.get(person.playerId) ?? 0;
      return lpDelta > 0
        ? [
            {
              playerId: person.playerId,
              alias: person.alias,
              isYou: person.isYou,
              lpDelta,
            },
          ]
        : [];
    })
    .toSorted(
      (left, right) =>
        right.lpDelta - left.lpDelta ||
        left.alias.toLowerCase().localeCompare(right.alias.toLowerCase()) ||
        left.playerId - right.playerId,
    )
    .slice(0, HOME_CLIMBERS);
}
