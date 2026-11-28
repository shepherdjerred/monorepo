import {
  HallRecordEvidenceSchema,
  HallRecordHolderSchema,
  compareHallCandidate,
  hallRecordValue,
  type HallCandidate,
  type HallEligibleMatch,
  type HallQueueFamilyId,
  type HallRecordHolder,
  type HallRecordId,
  type HallRecordMatch,
  type QueueType,
} from "@scout-for-lol/data";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { LeaguePuuid } from "@scout-for-lol/domain/identity/league-account.ts";
import { z } from "zod";
import { parseProgressionJson } from "#src/progression/json.ts";

const HALL_RANK_COUNT = 3;
const HallRankSchema = z
  .strictObject({
    value: z.number(),
    evidence: HallRecordEvidenceSchema.array().nonempty(),
  })
  .refine(
    (rank) => rank.evidence.every((entry) => entry.value === rank.value),
    {
      message: "Hall rank evidence must match its score",
    },
  );

const HallRankingsSchema = z.strictObject({
  baselineRevision: z.number().int().nonnegative(),
  standings: HallRankSchema.array()
    .max(HALL_RANK_COUNT)
    .refine(
      (ranks) =>
        ranks.every((rank, index) => {
          const next = ranks[index + 1];
          return next === undefined || rank.value > next.value;
        }),
      { message: "Hall rank scores must be distinct and descending" },
    ),
});

type HallRank = z.infer<typeof HallRankSchema>;
export type HallStandings = HallRank[];
export type HallTrackedAccount = {
  readonly id: number;
  readonly alias: string;
  readonly puuid: LeaguePuuid;
  readonly createdTime: Date;
  readonly player: { readonly id: number; readonly alias: string };
};
export type HallMatchRow = HallEligibleMatch &
  HallRecordMatch & {
    readonly match_id: RiotMatchId;
    readonly queue: QueueType;
  };

export function hallCellKey(queueFamilyId: string, recordId: string): string {
  return `${queueFamilyId}:${recordId}`;
}

export function hallHolderFor(account: HallTrackedAccount): HallRecordHolder {
  return HallRecordHolderSchema.parse({
    playerId: account.player.id,
    playerAlias: account.player.alias,
    accountId: account.id,
    accountAlias: account.alias,
    puuid: account.puuid,
  });
}

export function hallCandidateFor(
  match: HallMatchRow,
  holder: HallRecordHolder,
  queueFamilyId: HallQueueFamilyId,
  recordId: HallRecordId,
): HallCandidate {
  const value = hallRecordValue(match, recordId);
  return {
    queueFamilyId,
    recordId,
    value,
    holder,
    evidence: HallRecordEvidenceSchema.parse({
      matchId: match.match_id,
      gameEndAt: match.game_end_at,
      value,
      holder,
    }),
  };
}

export function addHallCandidate(
  standings: HallStandings,
  candidate: HallCandidate,
): HallStandings {
  const position = standings.findIndex((rank) => candidate.value >= rank.value);
  const index = position === -1 ? standings.length : position;
  if (index === HALL_RANK_COUNT) {
    return standings;
  }

  const rank = standings[index];
  const tied = rank?.value === candidate.value ? rank : undefined;
  const comparison = compareHallCandidate(
    tied?.value ?? null,
    tied?.evidence.map((entry) => entry.holder) ?? [],
    tied?.evidence ?? [],
    candidate,
  );
  if (comparison.kind === "below") {
    return standings;
  }

  const updated = [...standings];
  updated.splice(index, tied === undefined ? 0 : 1, {
    value: candidate.value,
    evidence: comparison.evidence,
  });
  return updated.slice(0, HALL_RANK_COUNT);
}

export function hallStandingsFromCell(cell: {
  baselineRevision: number;
  rankingsJson: string | null;
}): HallStandings | null {
  if (cell.rankingsJson === null) {
    return null;
  }
  const saved = parseProgressionJson(cell.rankingsJson, HallRankingsSchema);
  // An older baseline worker can rebuild the #1 columns during rollout.
  return saved.baselineRevision === cell.baselineRevision
    ? saved.standings
    : null;
}

export function legacyHallStandings(cell: {
  currentValue: number | null;
  evidenceJson: string;
}): HallStandings {
  if (cell.currentValue === null) {
    return [];
  }
  return [
    HallRankSchema.parse({
      value: cell.currentValue,
      evidence: parseProgressionJson(
        cell.evidenceJson,
        HallRecordEvidenceSchema.array(),
      ),
    }),
  ];
}

export function hallRankScore(rank: HallRank): {
  value: number;
  holders: HallRecordHolder[];
} {
  return {
    value: rank.value,
    holders: rank.evidence.map((entry) => entry.holder),
  };
}

export function hallRankingsColumns(
  standings: HallStandings,
  baselineRevision: number,
) {
  const top = standings[0];
  return {
    currentValue: top?.value ?? null,
    holdersJson: JSON.stringify(
      top === undefined ? [] : hallRankScore(top).holders,
    ),
    evidenceJson: JSON.stringify(top?.evidence ?? []),
    rankingsJson: JSON.stringify({ baselineRevision, standings }),
  };
}
