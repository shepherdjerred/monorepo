import {
  DareCompiledPlanV2Schema,
  DareParaphraseCorpusSchema,
  DiscordAccountIdSchema,
  RawMatchSchema,
  RawParticipantSchema,
  type DareParaphraseCorpus,
  type DareTargetBindingV2,
  type RawMatch,
} from "@scout-for-lol/data";

const CORPUS_URL = new URL(
  "../../../../data/src/model/bucks/dare-v2-paraphrase-corpus.json",
  import.meta.url,
);

export const TWISTED_FATE_SAME_GAME_PLAN = DareCompiledPlanV2Schema.parse({
  version: 2,
  maxEligibleGames: 100,
  gameSets: [
    {
      name: "qualifying_game",
      targetKeys: ["virmel"],
      relationship: "independent",
      queues: ["solo", "flex", "ranked 5s"],
      predicate: {
        kind: "and",
        operands: [
          {
            kind: "comparison",
            value: {
              kind: "participant",
              target: "virmel",
              field: "champion_name",
            },
            operator: "eq",
            threshold: "Twisted Fate",
          },
          {
            kind: "comparison",
            value: {
              kind: "participant_rate",
              target: "virmel",
              field: "cs_per_minute",
            },
            operator: "gte",
            threshold: 8,
          },
          {
            kind: "comparison",
            value: {
              kind: "participant",
              target: "virmel",
              field: "time_played",
            },
            operator: "gte",
            threshold: 1200,
          },
        ],
      },
      projections: [],
      orderBy: "game_end_at_asc_match_id_asc",
      limit: 100,
    },
  ],
  result: {
    kind: "matching_games",
    gameSet: "qualifying_game",
    operator: "gte",
    threshold: 1,
  },
});

export const DEATHCAP_TIMELINE_PLAN = DareCompiledPlanV2Schema.parse({
  ...TWISTED_FATE_SAME_GAME_PLAN,
  gameSets: [
    {
      ...TWISTED_FATE_SAME_GAME_PLAN.gameSets[0],
      predicate: {
        kind: "comparison",
        value: {
          kind: "timeline_event_count",
          eventType: "ITEM_PURCHASED",
          target: "virmel",
          role: "subject",
          afterMs: null,
          beforeMs: null,
          itemId: 3089,
          monsterType: null,
          buildingType: null,
        },
        operator: "gte",
        threshold: 1,
      },
    },
  ],
});

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

export async function loadDareParaphraseCorpus(): Promise<DareParaphraseCorpus> {
  const raw: unknown = await Bun.file(CORPUS_URL).json();
  return DareParaphraseCorpusSchema.parse(raw);
}

export function dareTargetBindingsForAliases(
  targetAliases: Readonly<Record<string, string>>,
): DareTargetBindingV2[] {
  return Object.entries(targetAliases).map(([key, alias], index) => ({
    key,
    alias,
    discordId: DiscordAccountIdSchema.parse(
      `1000000000000000${index.toString()}`,
    ),
    playerId: index + 1,
    accounts: [
      {
        puuid: `${key}-frozen-puuid`,
        trackingStartedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  }));
}
