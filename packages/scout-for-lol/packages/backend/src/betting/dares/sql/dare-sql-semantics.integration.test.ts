import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DareSqlCompilationSchema,
  type DareSqlEvidence,
  type RawMatch,
} from "@scout-for-lol/data";
import {
  dareSqlTargetForMatch as targetForMatch,
  dareSqlTimelineForMatch,
  loadDareSqlMatchFixture as loadMatchFixture,
} from "#src/betting/dares/sql/dare-sql-test-fixture.ts";
import {
  compileDareSql,
  executeDareSql,
} from "#src/betting/dares/sql/dare-sql.ts";
import {
  writeMatchStagingFile,
  writeTimelineStagingFiles,
} from "#src/report-lake/staging.ts";

let lakeDir: string;

beforeEach(async () => {
  lakeDir = await mkdtemp(path.join(tmpdir(), "dare-v3-semantics-"));
});

afterEach(async () => {
  await rm(lakeDir, { recursive: true, force: true });
});

function matchAt(
  base: RawMatch,
  index: number,
  win: boolean,
  championId: number,
): RawMatch {
  const match = structuredClone(base);
  const start = base.info.gameStartTimestamp + index * 3_600_000;
  match.metadata.matchId = RiotMatchIdSchema.parse(
    `NA1_81001${index.toString()}`,
  );
  match.info.gameId = base.info.gameId + index + 1;
  match.info.gameCreation = start;
  match.info.gameStartTimestamp = start;
  match.info.gameEndTimestamp = start + 1_800_000;
  const participant = match.info.participants[0];
  if (participant === undefined) throw new Error("fixture participant missing");
  participant.win = win;
  participant.championId = championId;
  const team = match.info.teams.find(
    (candidate) => candidate.teamId === participant.teamId,
  );
  if (team === undefined) throw new Error("fixture team missing");
  team.win = win;
  return match;
}

const EVENT_ORDER = (left: string, right: string) => `(
  ${right}.event_timestamp_ms > ${left}.event_timestamp_ms OR
  (${right}.event_timestamp_ms = ${left}.event_timestamp_ms AND ${right}.frame_index > ${left}.frame_index) OR
  (${right}.event_timestamp_ms = ${left}.event_timestamp_ms AND ${right}.frame_index = ${left}.frame_index AND ${right}.event_index > ${left}.event_index)
)`;

function itemSequenceSql(exact: boolean): string {
  const intervening = exact
    ? `AND NOT EXISTS (
        SELECT 1 FROM timeline_events mid
        WHERE mid.match_id = p.match_id
          AND mid.participant_id = p.participant_id
          AND mid.event_type = 'ITEM_PURCHASED'
          AND ${EVENT_ORDER("e1", "mid")}
          AND ${EVENT_ORDER("mid", "e2")}
      )`
    : "";
  return `WITH sequence_games AS (
    SELECT p.match_id, p.game_end_at,
      EXISTS (
        SELECT 1 FROM timeline_events e1
        JOIN timeline_events e2 ON e2.match_id = e1.match_id
        WHERE e1.match_id = p.match_id
          AND e1.participant_id = p.participant_id
          AND e2.participant_id = p.participant_id
          AND e1.event_type = 'ITEM_PURCHASED' AND e1.item_id = 1001
          AND e2.event_type = 'ITEM_PURCHASED' AND e2.item_id = 1002
          AND ${EVENT_ORDER("e1", "e2")}
          ${intervening}
      ) AS matched,
      2 AS sequence_step
    FROM T1 p
  )
  SELECT COUNT(*) FILTER (WHERE matched IS TRUE) >= 1 AS achieved
  FROM sequence_games, timeline_coverage
  WHERE sequence_games.match_id = timeline_coverage.match_id`;
}

function skillSequenceSql(): string {
  return `WITH sequence_games AS (
    SELECT p.match_id, p.game_end_at,
      EXISTS (
        SELECT 1 FROM timeline_events q
        JOIN timeline_events w ON w.match_id = q.match_id
        JOIN timeline_events r ON r.match_id = q.match_id
        WHERE q.match_id = p.match_id
          AND q.participant_id = p.participant_id
          AND w.participant_id = p.participant_id
          AND r.participant_id = p.participant_id
          AND q.event_type = 'SKILL_LEVEL_UP' AND q.skill_slot = 1
          AND w.event_type = 'SKILL_LEVEL_UP' AND w.skill_slot = 2
          AND r.event_type = 'SKILL_LEVEL_UP' AND r.skill_slot = 4
          AND ${EVENT_ORDER("q", "w")}
          AND ${EVENT_ORDER("w", "r")}
      ) AS matched,
      4 AS skill_slot
    FROM T1 p
  )
  SELECT COUNT(*) FILTER (WHERE matched IS TRUE) >= 1 AS achieved
  FROM sequence_games, timeline_coverage
  WHERE sequence_games.match_id = timeline_coverage.match_id`;
}

function expectSequenceTimeline(
  events: DareSqlEvidence["timelineEvents"],
): void {
  expect(
    events.map((event) => ({
      type: event.type,
      timestampMs: event.timestampMs,
      itemId: event.itemId,
      skillSlot: event.skillSlot,
    })),
  ).toEqual([
    {
      type: "ITEM_PURCHASED",
      timestampMs: 1000,
      itemId: 1001,
      skillSlot: null,
    },
    {
      type: "ITEM_PURCHASED",
      timestampMs: 1000,
      itemId: 9999,
      skillSlot: null,
    },
    { type: "ITEM_SOLD", timestampMs: 1000, itemId: 1001, skillSlot: null },
    {
      type: "ITEM_PURCHASED",
      timestampMs: 1000,
      itemId: 1002,
      skillSlot: null,
    },
    { type: "SKILL_LEVEL_UP", timestampMs: 2000, itemId: null, skillSlot: 1 },
    { type: "SKILL_LEVEL_UP", timestampMs: 2000, itemId: null, skillSlot: 2 },
    { type: "SKILL_LEVEL_UP", timestampMs: 2000, itemId: null, skillSlot: 4 },
  ]);
}

describe("Dare SQL extended match semantics", () => {
  test("eligible misses reset a distinct-champion winning streak", async () => {
    const base = await loadMatchFixture();
    const excludedQueueLoss = matchAt(base, 4, false, 99);
    excludedQueueLoss.info.queueId = 450;
    const games = [
      matchAt(base, 0, true, 1),
      matchAt(base, 1, true, 2),
      matchAt(base, 2, false, 3),
      matchAt(base, 3, true, 4),
      excludedQueueLoss,
      matchAt(base, 5, true, 5),
      matchAt(base, 6, true, 6),
    ];
    for (const game of games)
      expect(await writeMatchStagingFile(lakeDir, game)).toBe(true);
    const lastGame = games.at(-1);
    if (lastGame === undefined) throw new Error("streak fixture is empty");
    const queryText = `WITH ordered AS (
      SELECT match_id, game_end_at, champion_id, win,
        SUM(CASE WHEN win IS FALSE THEN 1 ELSE 0 END) OVER (
          ORDER BY game_end_at, match_id
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS run_id
      FROM T1 WHERE queue_id = 420
    ), streak_games AS (
      SELECT match_id, game_end_at, win AS matched, champion_id FROM ordered
    )
    SELECT EXISTS (
      SELECT 1 FROM ordered WHERE win IS TRUE GROUP BY run_id
      HAVING COUNT(*) >= 3 AND COUNT(DISTINCT champion_id) >= 3
    ) AS achieved`;
    const compilation = await compileDareSql({
      queryText,
      targetKeys: ["T1"],
    });
    const evidence = await executeDareSql({
      compilation,
      targets: [targetForMatch(base)],
      start: new Date(base.info.gameStartTimestamp - 60_000),
      end: new Date(lastGame.info.gameEndTimestamp),
      lakeDir,
    });
    expect(evidence.achieved).toBe(true);
    expect(evidence.results.map((row) => row.matched)).toEqual([
      true,
      true,
      false,
      true,
      true,
      true,
    ]);
  });

  test("ordered-subsequence permits an unrelated purchase while exact mode rejects it", async () => {
    const match = await loadMatchFixture();
    const participant = match.info.participants[0];
    if (participant === undefined)
      throw new Error("fixture participant missing");
    expect(await writeMatchStagingFile(lakeDir, match)).toBe(true);
    const timeline = dareSqlTimelineForMatch(match, [
      {
        timestamp: 60_000,
        participantFrames: null,
        events: [
          {
            timestamp: 1000,
            type: "ITEM_PURCHASED",
            participantId: participant.participantId,
            itemId: 1001,
          },
          {
            timestamp: 1000,
            type: "ITEM_PURCHASED",
            participantId: participant.participantId,
            itemId: 9999,
          },
          {
            timestamp: 1000,
            type: "ITEM_SOLD",
            participantId: participant.participantId,
            itemId: 1001,
          },
          {
            timestamp: 1000,
            type: "ITEM_PURCHASED",
            participantId: participant.participantId,
            itemId: 1002,
          },
          {
            timestamp: 2000,
            type: "SKILL_LEVEL_UP",
            participantId: participant.participantId,
            skillSlot: 1,
          },
          {
            timestamp: 2000,
            type: "SKILL_LEVEL_UP",
            participantId: participant.participantId,
            skillSlot: 2,
          },
          {
            timestamp: 2000,
            type: "SKILL_LEVEL_UP",
            participantId: participant.participantId,
            skillSlot: 4,
          },
        ],
      },
    ]);
    expect(await writeTimelineStagingFiles(lakeDir, timeline, new Date())).toBe(
      true,
    );
    const execute = async (exact: boolean) => {
      const compilation = await compileDareSql({
        queryText: itemSequenceSql(exact),
        targetKeys: ["T1"],
      });
      return await executeDareSql({
        compilation,
        targets: [targetForMatch(match)],
        start: new Date(match.info.gameStartTimestamp - 60_000),
        end: new Date(match.info.gameEndTimestamp + 60_000),
        lakeDir,
      });
    };
    const subsequence = await execute(false);
    expect(subsequence).toMatchObject({
      achieved: true,
      coverage: "complete",
    });
    expectSequenceTimeline(subsequence.timelineEvents);
    await expect(execute(true)).resolves.toMatchObject({
      achieved: false,
      coverage: "complete",
    });
    const skillCompilation = await compileDareSql({
      queryText: skillSequenceSql(),
      targetKeys: ["T1"],
    });
    await expect(
      executeDareSql({
        compilation: skillCompilation,
        targets: [targetForMatch(match)],
        start: new Date(match.info.gameStartTimestamp - 60_000),
        end: new Date(match.info.gameEndTimestamp + 60_000),
        lakeDir,
      }),
    ).resolves.toMatchObject({
      achieved: true,
      results: [
        {
          gameSet: "sequence_games",
          projections: { skill_slot: 4 },
        },
      ],
    });
  });
});

describe("Dare SQL eligibility boundaries", () => {
  test("opponent-team comparisons exclude multi-team matches", async () => {
    const match = structuredClone(await loadMatchFixture());
    const firstTeam = match.info.teams[0];
    if (firstTeam === undefined) throw new Error("fixture team missing");
    match.info.teams.push({ ...structuredClone(firstTeam), teamId: 300 });
    expect(await writeMatchStagingFile(lakeDir, match)).toBe(true);
    const compilation = await compileDareSql({
      queryText:
        "SELECT EXISTS (SELECT 1 FROM T1 p JOIN match_teams o ON o.match_id = p.match_id AND NOT (o.team_id = p.team_id) WHERE o.dragon_kills > 0) AS achieved",
      targetKeys: ["T1"],
    });
    const evidence = await executeDareSql({
      compilation,
      targets: [targetForMatch(match)],
      start: new Date(match.info.gameStartTimestamp - 60_000),
      end: new Date(match.info.gameEndTimestamp + 60_000),
      lakeDir,
    });
    expect(evidence).toMatchObject({ achieved: false, sourceMatchIds: [] });
  });

  test("excludes a match that started before activation", async () => {
    const match = await loadMatchFixture();
    expect(await writeMatchStagingFile(lakeDir, match)).toBe(true);
    const compilation = await compileDareSql({
      queryText: "SELECT COUNT(*) >= 1 AS achieved FROM T1",
      targetKeys: ["T1"],
    });

    await expect(
      executeDareSql({
        compilation,
        targets: [targetForMatch(match)],
        start: new Date(match.info.gameStartTimestamp + 60_000),
        end: new Date(match.info.gameEndTimestamp + 60_000),
        lakeDir,
      }),
    ).resolves.toMatchObject({ achieved: false, sourceMatchIds: [] });
  });

  test("selects the newest games for a last-games baseline", async () => {
    const base = await loadMatchFixture();
    const games = [
      matchAt(base, 0, true, 1),
      matchAt(base, 1, true, 2),
      matchAt(base, 2, true, 3),
    ];
    for (const game of games)
      expect(await writeMatchStagingFile(lakeDir, game)).toBe(true);
    const compiled = await compileDareSql({
      queryText: "SELECT COUNT(*) >= 1 AS achieved FROM T1",
      targetKeys: ["T1"],
    });
    const compilation = DareSqlCompilationSchema.parse({
      ...compiled,
      maxEligibleGames: 2,
    });
    const last = games.at(-1);
    if (last === undefined) throw new Error("newest-game fixture is empty");

    await expect(
      executeDareSql({
        compilation,
        targets: [targetForMatch(base)],
        start: new Date(base.info.gameStartTimestamp - 60_000),
        end: new Date(last.info.gameEndTimestamp + 60_000),
        lakeDir,
        matchOrder: "newest",
      }),
    ).resolves.toMatchObject({
      sourceMatchIds: ["NA1_810011", "NA1_810012"],
    });
  });

  test("applies the game cap after excluding multi-team matches", async () => {
    const base = await loadMatchFixture();
    const unsupported = matchAt(base, 0, true, 1);
    const firstTeam = unsupported.info.teams[0];
    if (firstTeam === undefined) throw new Error("fixture team missing");
    unsupported.info.teams.push({
      ...structuredClone(firstTeam),
      teamId: 300,
    });
    const supported = matchAt(base, 1, true, 2);
    expect(await writeMatchStagingFile(lakeDir, unsupported)).toBe(true);
    expect(await writeMatchStagingFile(lakeDir, supported)).toBe(true);
    const compiled = await compileDareSql({
      queryText:
        "SELECT COUNT(*) >= 1 AS achieved FROM T1 p JOIN match_teams o ON o.match_id = p.match_id AND o.team_id <> p.team_id",
      targetKeys: ["T1"],
    });
    const compilation = DareSqlCompilationSchema.parse({
      ...compiled,
      maxEligibleGames: 1,
    });

    await expect(
      executeDareSql({
        compilation,
        targets: [targetForMatch(base)],
        start: new Date(base.info.gameStartTimestamp - 60_000),
        end: new Date(supported.info.gameEndTimestamp + 60_000),
        lakeDir,
      }),
    ).resolves.toMatchObject({
      achieved: true,
      sourceMatchIds: ["NA1_810011"],
    });
  });

  test("applies the game cap after excluding remakes", async () => {
    const base = await loadMatchFixture();
    const remake = matchAt(base, 0, true, 1);
    // Riot marks a remake with the early-surrender flags, not a short clock.
    remake.info.gameDuration = 120;
    for (const participant of remake.info.participants) {
      participant.gameEndedInEarlySurrender = true;
      participant.teamEarlySurrendered = true;
    }
    const completed = matchAt(base, 1, true, 2);
    expect(await writeMatchStagingFile(lakeDir, remake)).toBe(true);
    expect(await writeMatchStagingFile(lakeDir, completed)).toBe(true);
    const compiled = await compileDareSql({
      queryText: "SELECT COUNT(*) >= 1 AS achieved FROM T1",
      targetKeys: ["T1"],
    });
    const compilation = DareSqlCompilationSchema.parse({
      ...compiled,
      maxEligibleGames: 1,
    });

    await expect(
      executeDareSql({
        compilation,
        targets: [targetForMatch(base)],
        start: new Date(base.info.gameStartTimestamp - 60_000),
        end: new Date(completed.info.gameEndTimestamp + 60_000),
        lakeDir,
      }),
    ).resolves.toMatchObject({
      achieved: true,
      sourceMatchIds: ["NA1_810011"],
    });
  });
});
