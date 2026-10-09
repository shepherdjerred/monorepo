import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { vi } from "vitest";
import {
  DareSqlEvidenceSchema,
  RawMatchSchema,
  RawParticipantSchema,
  type DareSqlEvidence,
  type RawMatch,
} from "@scout-for-lol/data";

export function makeTwistedFateMatch(
  fixture: RawMatch,
  input: {
    matchId: RiotMatchId;
    timePlayed: number;
    creepScore: number;
    gameStartTimestamp?: number | undefined;
    teamPosition?: string | undefined;
  },
): RawMatch {
  const copy = RawMatchSchema.parse(structuredClone(fixture));
  const target = RawParticipantSchema.parse({
    ...copy.info.participants[0],
    puuid:
      "virmel-puuid000000000000000000000000000000000000000000000000000000000000000000",
    championName: "TwistedFate",
    timePlayed: input.timePlayed,
    totalMinionsKilled: input.creepScore,
    neutralMinionsKilled: 0,
    ...(input.teamPosition === undefined
      ? {}
      : { teamPosition: input.teamPosition }),
  });
  const timing =
    input.gameStartTimestamp === undefined
      ? {}
      : {
          gameDuration: input.timePlayed,
          gameStartTimestamp: input.gameStartTimestamp,
          gameEndTimestamp: input.gameStartTimestamp + input.timePlayed * 1000,
        };
  return RawMatchSchema.parse({
    ...copy,
    metadata: { ...copy.metadata, matchId: input.matchId },
    info: {
      ...copy.info,
      ...timing,
      queueId: 420,
      participants: [target, ...copy.info.participants.slice(1)],
    },
  });
}

/**
 * The compilation fields every test contract repeats.
 *
 * Two suites need a parseable ScoutQL-3 contract for entirely different
 * reasons — one evaluates activation snapshots, one proves the settlement's
 * notification wiring — and neither cares what the query says. Only the
 * fields they genuinely differ on stay at the call site; this is the shape
 * the schema demands and nothing more.
 */
export function dareSqlContractCore(input: {
  queryHash: string;
  maxEligibleGames: number;
}) {
  return {
    version: 3,
    canonicalSql: "SELECT FALSE AS achieved",
    immutableAst: "{}",
    queryHash: input.queryHash,
    maxEligibleGames: input.maxEligibleGames,
    compilerVersion: "dare-scoutql-3",
    evaluatorVersion: "dare-evaluator-3",
    finality: "deadline_only",
    facts: {
      cteCount: 1,
      joinedRelations: 0,
      predicates: 0,
      maxExpressionDepth: 1,
      physicalSources: ["match_participants"],
      functions: [],
      targetKeys: ["T1"],
    },
    resultStructure: {
      gameSets: [
        {
          name: "attempts",
          projectionColumns: ["score"],
          targetDependencies: ["T1"],
        },
      ],
    },
    competition: { kind: "standard" },
  };
}

/** What the stubbed lake answers for every contract execution. */
export type StubbedLake = {
  achieved: boolean | null;
  sourceMatchIds: string[];
};

/**
 * Replacements for the lake-executing exports of `dare-sql.ts`, for a test's
 * `vi.mock` factory to spread over the real module.
 */
export function dareSqlLakeStubs(lake: StubbedLake) {
  return {
    executeDareSql: (input: {
      compilation: { queryHash: string };
      targets: readonly { key: string }[];
    }): Promise<DareSqlEvidence> =>
      Promise.resolve(
        DareSqlEvidenceSchema.parse({
          achieved: lake.achieved,
          results: [],
          targetDependencies: input.targets.map((target) => target.key),
          coverage: "complete",
          sourceMatchIds: lake.sourceMatchIds,
          queryHash: input.compilation.queryHash,
        }),
      ),
    decisiveTargetDependencies: (input: {
      targets: readonly { key: string }[];
    }) => Promise.resolve(input.targets.map((target) => target.key)),
  };
}

export async function loadRiftFixture(): Promise<RawMatch> {
  return RawMatchSchema.parse(
    await Bun.file(
      new URL("../../../../../testdata/rift.json", import.meta.url),
    ).json(),
  );
}

/** A 25-minute Twisted Fate game by the stubbed target, started at `startAt`. */
export function targetMatchAt(
  fixture: RawMatch,
  matchId: RiotMatchId,
  startAt: Date,
  creepScore = 200,
): RawMatch {
  return makeTwistedFateMatch(fixture, {
    matchId,
    timePlayed: 25 * 60,
    creepScore,
    gameStartTimestamp: startAt.getTime(),
  });
}

/**
 * Evidence that resolves a one-game contract unachieved on `matchId`: the
 * game cap is reached, so the Dare is final on that match.
 */
export function finalUnachievedEvidence(input: {
  matchId: RiotMatchId;
  queryHash: string;
}): DareSqlEvidence {
  return DareSqlEvidenceSchema.parse({
    achieved: false,
    results: [],
    targetDependencies: ["T1"],
    coverage: "complete",
    sourceMatchIds: [input.matchId],
    queryHash: input.queryHash,
    timelineEvents: [],
  });
}

/**
 * The `dare-sql.ts` module with only lake execution replaced, for a
 * `vi.mock` factory: compilation stays real, evidence comes from `lake`.
 */
export async function stubbedDareSqlModule(
  lake: StubbedLake,
): Promise<Record<string, unknown>> {
  const actual = await vi.importActual<Record<string, unknown>>(
    "#src/betting/dares/sql/dare-sql.ts",
  );
  return { ...actual, ...dareSqlLakeStubs(lake) };
}

/**
 * A `dare-sql.ts` replacement whose every execution resolves a one-game
 * contract unachieved and final on `matchId`.
 */
export function finalUnachievedDareSqlModule(input: {
  matchId: RiotMatchId;
  queryHash: string;
}) {
  return {
    executeDareSql: () => Promise.resolve(finalUnachievedEvidence(input)),
    decisiveTargetDependencies: () => Promise.resolve(["T1"]),
  };
}
