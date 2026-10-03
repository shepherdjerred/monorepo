import {
  RawMatchSchema,
  RawParticipantSchema,
  type RawMatch,
} from "@scout-for-lol/data";

export function makeTwistedFateMatch(
  fixture: RawMatch,
  input: {
    matchId: string;
    timePlayed: number;
    creepScore: number;
    gameStartTimestamp?: number | undefined;
    teamPosition?: string | undefined;
  },
): RawMatch {
  const copy = RawMatchSchema.parse(structuredClone(fixture));
  const target = RawParticipantSchema.parse({
    ...copy.info.participants[0],
    puuid: "virmel-puuid",
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
