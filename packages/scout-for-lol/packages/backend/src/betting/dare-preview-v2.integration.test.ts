import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import {
  DareCompiledPlanV2Schema,
  DiscordAccountIdSchema,
  RawMatchSchema,
  type DareTargetBindingV2,
  type RawMatch,
} from "@scout-for-lol/data";
import { historicallyPreviewDareV2 } from "#src/betting/dare-preview-v2.ts";
import { writeMatchStagingFile } from "#src/report-lake/staging.ts";

const createdDirs: string[] = [];

async function makeLakeDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "dare-preview-v2-"));
  createdDirs.push(dir);
  return dir;
}

async function loadMatchFixture(): Promise<RawMatch> {
  const fixtureUrl = new URL(
    "../league/model/__tests__/testdata/matches_2025_09_19_NA1_5370969615.json",
    import.meta.url,
  );
  const json: unknown = await Bun.file(fixtureUrl).json();
  return RawMatchSchema.parse(json);
}

function configuredMatch(
  fixture: RawMatch,
  input: {
    matchId: string;
    start: number;
    timePlayed: number;
    minions: number;
    targetPuuid: string;
  },
): RawMatch {
  return RawMatchSchema.parse({
    ...fixture,
    metadata: { ...fixture.metadata, matchId: input.matchId },
    info: {
      ...fixture.info,
      gameCreation: input.start,
      gameStartTimestamp: input.start,
      gameEndTimestamp: input.start + input.timePlayed * 1000,
      gameDuration: input.timePlayed,
      queueId: 420,
      gameMode: "CLASSIC",
      mapId: 11,
      endOfGameResult: "GameComplete",
      participants: fixture.info.participants.map((participant, index) =>
        index === 0
          ? {
              ...participant,
              puuid: input.targetPuuid,
              championName: "Twisted Fate",
              timePlayed: input.timePlayed,
              totalMinionsKilled: input.minions,
              neutralMinionsKilled: 0,
            }
          : participant,
      ),
    },
  });
}

function matchingGameSet(name: string, predicate: unknown) {
  return {
    name,
    targetKeys: ["virmel"],
    relationship: "independent" as const,
    queues: ["solo" as const],
    predicate,
    projections: [],
    orderBy: "game_end_at_asc_match_id_asc" as const,
    limit: 100,
  };
}

const championPredicate = {
  kind: "comparison" as const,
  value: {
    kind: "participant" as const,
    target: "virmel",
    field: "champion_name" as const,
  },
  operator: "eq" as const,
  threshold: "Twisted Fate",
};

const csPredicate = {
  kind: "comparison" as const,
  value: {
    kind: "participant_rate" as const,
    target: "virmel",
    field: "cs_per_minute" as const,
  },
  operator: "gte" as const,
  threshold: 8,
};

const durationPredicate = {
  kind: "comparison" as const,
  value: {
    kind: "participant" as const,
    target: "virmel",
    field: "time_played" as const,
  },
  operator: "gte" as const,
  threshold: 1200,
};

afterAll(async () => {
  await Promise.all(
    createdDirs.map(
      async (dir) => await rm(dir, { recursive: true, force: true }),
    ),
  );
});

describe("Dare v2 historical preview", () => {
  test("distinguishes one-game conjunctions from cross-game branches", async () => {
    const fixture = await loadMatchFixture();
    const targetPuuid = "preview-virmel-puuid";
    const lakeDir = await makeLakeDir();
    const start = Date.parse("2025-09-01T00:00:00.000Z");
    await writeMatchStagingFile(
      lakeDir,
      configuredMatch(fixture, {
        matchId: "NA1_preview_cs",
        start,
        timePlayed: 600,
        minions: 80,
        targetPuuid,
      }),
    );
    await writeMatchStagingFile(
      lakeDir,
      configuredMatch(fixture, {
        matchId: "NA1_preview_duration",
        start: start + 3_600_000,
        timePlayed: 1200,
        minions: 20,
        targetPuuid,
      }),
    );
    const targets: DareTargetBindingV2[] = [
      {
        key: "virmel",
        discordId: DiscordAccountIdSchema.parse("160509172704739328"),
        playerId: 1,
        alias: "Virmel",
        accounts: [
          {
            puuid: targetPuuid,
            trackingStartedAt: "2025-01-01T00:00:00.000Z",
          },
        ],
      },
    ];
    const sameGame = DareCompiledPlanV2Schema.parse({
      version: 2,
      maxEligibleGames: 100,
      gameSets: [
        matchingGameSet("one_game", {
          kind: "and",
          operands: [championPredicate, csPredicate, durationPredicate],
        }),
      ],
      result: {
        kind: "matching_games",
        gameSet: "one_game",
        operator: "gte",
        threshold: 1,
      },
    });
    const separateGames = DareCompiledPlanV2Schema.parse({
      version: 2,
      maxEligibleGames: 100,
      gameSets: [
        matchingGameSet("cs_game", {
          kind: "and",
          operands: [championPredicate, csPredicate],
        }),
        matchingGameSet("duration_game", {
          kind: "and",
          operands: [championPredicate, durationPredicate],
        }),
      ],
      result: {
        kind: "and",
        operands: [
          {
            kind: "matching_games",
            gameSet: "cs_game",
            operator: "gte",
            threshold: 1,
          },
          {
            kind: "matching_games",
            gameSet: "duration_game",
            operator: "gte",
            threshold: 1,
          },
        ],
      },
    });
    const range = {
      targets,
      start: new Date(start - 1000),
      end: new Date(start + 7_200_000),
      lakeDir,
    };

    await expect(
      historicallyPreviewDareV2({ ...range, plan: sameGame }),
    ).resolves.toMatchObject({ achieved: false, eligibleGames: 2 });
    await expect(
      historicallyPreviewDareV2({ ...range, plan: separateGames }),
    ).resolves.toMatchObject({ achieved: true, eligibleGames: 2 });
  });
});
