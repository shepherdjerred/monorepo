import { describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  RawMatchSchema,
  RawTimelineSchema,
  type DareTargetBindingV2,
  type RawMatch,
} from "@scout-for-lol/data";
import {
  compileDareSqlV3,
  decisiveTargetDependenciesV3,
  executeDareSqlV3,
} from "#src/betting/dare-sql-v3.ts";
import {
  writeMatchStagingFile,
  writeTimelineStagingFiles,
} from "#src/report-lake/staging.ts";

const KILL_PARTICIPATION_SQL = `WITH games AS (
  SELECT p.match_id, p.game_end_at,
    (p.kills + p.assists) * 1.0 / NULLIF(t.champion_kills, 0) AS kill_participation,
    (p.kills + p.assists) * 1.0 / NULLIF(t.champion_kills, 0) >= 0 AS matched
  FROM T1 AS p
  JOIN match_teams AS t ON t.match_id = p.match_id AND t.team_id = p.team_id
  ORDER BY p.game_end_at ASC, p.match_id ASC
  LIMIT 100
)
SELECT COUNT(*) FILTER (WHERE matched IS TRUE) >= 1 AS achieved FROM games`;

async function loadMatchFixture(): Promise<RawMatch> {
  const fixtureUrl = new URL(
    "../league/model/__tests__/testdata/matches_2025_09_19_NA1_5370969615.json",
    import.meta.url,
  );
  const json: unknown = await Bun.file(fixtureUrl).json();
  const match = RawMatchSchema.parse(json);
  return RawMatchSchema.parse({
    ...match,
    info: { ...match.info, queueId: 420, gameMode: "CLASSIC", mapId: 11 },
  });
}

function targetForMatch(match: RawMatch): DareTargetBindingV2 {
  const participant = match.info.participants[0];
  if (participant === undefined) throw new Error("fixture participant missing");
  return {
    key: "T1",
    discordId: "100000000000000001",
    playerId: 1,
    alias: "Target",
    accounts: [
      {
        puuid: participant.puuid,
        trackingStartedAt: new Date(
          match.info.gameStartTimestamp - 1000,
        ).toISOString(),
      },
    ],
  };
}

function targetsForMatch(match: RawMatch): DareTargetBindingV2[] {
  const first = targetForMatch(match);
  return [
    first,
    {
      ...first,
      key: "T2",
      discordId: "100000000000000002",
      playerId: 2,
      alias: "Other target",
    },
  ];
}

describe("Dare SQL v3", () => {
  test("runs ordinary SQL over target, participant, and team relations", async () => {
    const match = await loadMatchFixture();
    const lakeDir = await mkdtemp(path.join(tmpdir(), "dare-sql-v3-"));
    try {
      expect(await writeMatchStagingFile(lakeDir, match)).toBe(true);
      const compilation = await compileDareSqlV3({
        queryText: KILL_PARTICIPATION_SQL,
        targetKeys: ["T1"],
      });
      const execution = {
        compilation,
        targets: [targetForMatch(match)],
        start: new Date(match.info.gameStartTimestamp - 1000),
        end: new Date(match.info.gameEndTimestamp + 1000),
        lakeDir,
      };
      const evidence = await executeDareSqlV3(execution);
      const participant = match.info.participants[0];
      if (participant === undefined)
        throw new Error("fixture participant missing");
      const team = match.info.teams.find(
        (candidate) => candidate.teamId === participant.teamId,
      );
      if (team === undefined) throw new Error("fixture team missing");

      expect(evidence).toEqual({
        achieved: true,
        results: [
          {
            gameSet: "games",
            matchId: match.metadata.matchId,
            gameEndAt: new Date(match.info.gameEndTimestamp).toISOString(),
            matched: true,
            projections: {
              kill_participation:
                (participant.kills + participant.assists) /
                team.objectives.champion.kills,
            },
            targetDependencies: ["T1"],
          },
        ],
        targetDependencies: ["T1"],
        coverage: "not_required",
        sourceMatchIds: [match.metadata.matchId],
        queryHash: compilation.queryHash,
      });
      await expect(executeDareSqlV3(execution)).resolves.toEqual(evidence);
      await expect(
        executeDareSqlV3({
          ...execution,
          compilation: {
            ...compilation,
            canonicalSql: "SELECT FALSE AS achieved FROM T1",
          },
        }),
      ).rejects.toThrow("does not match its immutable AST");
      // The filtered count is conservatively deadline-only until the
      // append-monotonicity of its CTE predicate can be proven.
      expect(compilation.finality).toBe("deadline_only");
      expect(compilation.maxEligibleGames).toBe(100);
    } finally {
      await rm(lakeDir, { recursive: true, force: true });
    }
  });

  test("returns NULL evidence when required timeline coverage is missing", async () => {
    const match = await loadMatchFixture();
    const lakeDir = await mkdtemp(path.join(tmpdir(), "dare-sql-v3-"));
    try {
      expect(await writeMatchStagingFile(lakeDir, match)).toBe(true);
      const compilation = await compileDareSqlV3({
        queryText:
          "SELECT EXISTS (SELECT 1 FROM timeline_events e JOIN timeline_coverage c USING (match_id) JOIN T1 p USING (match_id)) AS achieved",
        targetKeys: ["T1"],
      });
      const evidence = await executeDareSqlV3({
        compilation,
        targets: [targetForMatch(match)],
        start: new Date(match.info.gameStartTimestamp - 1000),
        end: new Date(match.info.gameEndTimestamp + 1000),
        lakeDir,
      });
      expect(evidence.coverage).toBe("missing_timeline");
      expect(evidence.achieved).toBeNull();
    } finally {
      await rm(lakeDir, { recursive: true, force: true });
    }
  });

  test("distinguishes a complete timeline with zero matching events", async () => {
    const match = await loadMatchFixture();
    const lakeDir = await mkdtemp(path.join(tmpdir(), "dare-sql-v3-"));
    try {
      expect(await writeMatchStagingFile(lakeDir, match)).toBe(true);
      const timeline = RawTimelineSchema.parse({
        metadata: {
          dataVersion: "2",
          matchId: match.metadata.matchId,
          participants: match.info.participants.map((row) => row.puuid),
        },
        info: {
          frameInterval: 60_000,
          gameId: match.info.gameId,
          participants: match.info.participants.map((row) => ({
            participantId: row.participantId,
            puuid: row.puuid,
          })),
          frames: [],
        },
      });
      expect(
        await writeTimelineStagingFiles(lakeDir, timeline, new Date()),
      ).toBe(true);
      const compilation = await compileDareSqlV3({
        queryText:
          "SELECT EXISTS (SELECT 1 FROM timeline_coverage c JOIN T1 p USING (match_id) JOIN timeline_events e USING (match_id) WHERE e.event_type = 'CHAMPION_KILL') AS achieved",
        targetKeys: ["T1"],
      });
      const evidence = await executeDareSqlV3({
        compilation,
        targets: [targetForMatch(match)],
        start: new Date(match.info.gameStartTimestamp - 1000),
        end: new Date(match.info.gameEndTimestamp + 1000),
        lakeDir,
      });
      expect(evidence).toMatchObject({ achieved: false, coverage: "complete" });
    } finally {
      await rm(lakeDir, { recursive: true, force: true });
    }
  });

  test("keeps kill participation NULL when the team has zero kills", async () => {
    const match = structuredClone(await loadMatchFixture());
    const target = match.info.participants[0];
    if (target === undefined) throw new Error("fixture participant missing");
    for (const participant of match.info.participants) {
      if (participant.teamId === target.teamId) participant.kills = 0;
    }
    const team = match.info.teams.find(
      (candidate) => candidate.teamId === target.teamId,
    );
    if (team === undefined) throw new Error("fixture team missing");
    team.objectives.champion.kills = 0;
    const lakeDir = await mkdtemp(path.join(tmpdir(), "dare-sql-v3-"));
    try {
      expect(await writeMatchStagingFile(lakeDir, match)).toBe(true);
      const compilation = await compileDareSqlV3({
        queryText: KILL_PARTICIPATION_SQL,
        targetKeys: ["T1"],
      });
      const evidence = await executeDareSqlV3({
        compilation,
        targets: [targetForMatch(match)],
        start: new Date(match.info.gameStartTimestamp - 1000),
        end: new Date(match.info.gameEndTimestamp + 1000),
        lakeDir,
      });

      expect(evidence.achieved).toBe(false);
      expect(evidence.results).toMatchObject([
        { matched: null, projections: { kill_participation: null } },
      ]);
    } finally {
      await rm(lakeDir, { recursive: true, force: true });
    }
  });
});

describe("Dare SQL v3 compilation", () => {
  test.each([">=", ">", "<=", "<", "=", "<>"])(
    "accepts the ordinary SQL %s comparison",
    async (operator) => {
      await expect(
        compileDareSqlV3({
          queryText: `SELECT COUNT(*) ${operator} 0 AS achieved FROM T1`,
          targetKeys: ["T1"],
        }),
      ).resolves.toMatchObject({ compilerVersion: "dare-sql-3" });
    },
  );

  test.each([
    [
      "damage share",
      "SELECT EXISTS (SELECT 1 FROM T1 p WHERE p.total_damage_dealt_to_champions * 1.0 / NULLIF((SELECT SUM(a.total_damage_dealt_to_champions) FROM match_participants a WHERE a.match_id = p.match_id AND a.team_id = p.team_id), 0) >= 0.25) AS achieved",
    ],
    [
      "gold and vision share",
      "SELECT EXISTS (SELECT 1 FROM T1 p WHERE p.gold_earned * 1.0 / NULLIF((SELECT SUM(a.gold_earned) FROM match_participants a WHERE a.match_id = p.match_id AND a.team_id = p.team_id), 0) >= 0.20 AND p.vision_score * 1.0 / NULLIF((SELECT SUM(a.vision_score) FROM match_participants a WHERE a.match_id = p.match_id AND a.team_id = p.team_id), 0) >= 0.20) AS achieved",
    ],
    [
      "teammate and opponent comparison",
      "SELECT EXISTS (SELECT 1 FROM T1 p JOIN match_participants teammate ON teammate.match_id = p.match_id AND teammate.team_id = p.team_id AND teammate.puuid <> p.puuid JOIN match_participants opponent ON opponent.match_id = p.match_id AND opponent.team_id <> p.team_id WHERE p.kills > teammate.kills AND p.kills > opponent.kills) AS achieved",
    ],
    [
      "team objectives",
      "SELECT EXISTS (SELECT 1 FROM T1 p JOIN match_teams t ON t.match_id = p.match_id AND t.team_id = p.team_id WHERE t.dragon_kills >= 3 AND t.first_baron) AS achieved",
    ],
  ])(
    "compiles %s with no Dare-specific vocabulary",
    async (_name, queryText) => {
      const compilation = await compileDareSqlV3({
        queryText,
        targetKeys: ["T1"],
      });
      expect(compilation.canonicalSql).not.toContain("dare_");
    },
  );

  test("attributes an achieved OR to its first decisive target branch", async () => {
    const match = await loadMatchFixture();
    const lakeDir = await mkdtemp(path.join(tmpdir(), "dare-sql-v3-"));
    try {
      expect(await writeMatchStagingFile(lakeDir, match)).toBe(true);
      const targets = targetsForMatch(match);
      const compilation = await compileDareSqlV3({
        queryText:
          "WITH first_branch AS (SELECT COUNT(*) > 0 AS matched FROM T1), second_branch AS (SELECT COUNT(*) > 0 AS matched FROM T2) SELECT (SELECT matched FROM first_branch) OR (SELECT matched FROM second_branch) AS achieved",
        targetKeys: ["T1", "T2"],
      });
      await expect(
        decisiveTargetDependenciesV3({
          compilation,
          targets,
          start: new Date(match.info.gameStartTimestamp - 1000),
          end: new Date(match.info.gameEndTimestamp + 1000),
          lakeDir,
        }),
      ).resolves.toEqual(["T1"]);
    } finally {
      await rm(lakeDir, { recursive: true, force: true });
    }
  });

  test("preserves the root FROM clause while evaluating CTE-backed OR branches", async () => {
    const match = await loadMatchFixture();
    const lakeDir = await mkdtemp(path.join(tmpdir(), "dare-sql-v3-"));
    try {
      expect(await writeMatchStagingFile(lakeDir, match)).toBe(true);
      const targets = targetsForMatch(match);
      const compilation = await compileDareSqlV3({
        queryText:
          "WITH flags AS (SELECT EXISTS (SELECT 1 FROM T1) AS t1_hit, EXISTS (SELECT 1 FROM T2) AS t2_hit) SELECT BOOL_OR(t1_hit OR t2_hit) AS achieved FROM flags",
        targetKeys: ["T1", "T2"],
      });
      await expect(
        decisiveTargetDependenciesV3({
          compilation,
          targets,
          start: new Date(match.info.gameStartTimestamp - 1000),
          end: new Date(match.info.gameEndTimestamp + 1000),
          lakeDir,
        }),
      ).resolves.toEqual(["T1", "T2"]);
    } finally {
      await rm(lakeDir, { recursive: true, force: true });
    }
  });

  test.each([
    [
      "custom Dare function",
      "SELECT COUNT(*) > dare_target('T1') AS achieved FROM T1",
      "function dare_target",
    ],
    [
      "unsafe division",
      "SELECT SUM(kills) / SUM(deaths) > 1 AS achieved FROM T1",
      "division must use NULLIF",
    ],
    [
      "timeline without coverage",
      "SELECT EXISTS (SELECT 1 FROM timeline_events JOIN T1 USING (match_id)) AS achieved",
      "must also read timeline_coverage",
    ],
    [
      "nondeterministic limit",
      "SELECT EXISTS (SELECT 1 FROM T1 LIMIT 1) AS achieved",
      "LIMIT must be ordered",
    ],
  ])("rejects %s", async (_name, queryText, expected) => {
    await expect(
      compileDareSqlV3({ queryText, targetKeys: ["T1"] }),
    ).rejects.toThrow(expected);
  });
});
