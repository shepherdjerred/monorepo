import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ACCOUNT_LAKE_COLUMNS,
  type AccountLakeRow,
  type MatchLakeRow,
  type MatchTeamBanLakeRow,
  type PrematchLakeRow,
  type TimelineCoverageLakeRow,
  type TimelineEventParticipantLakeRow,
  type TimelineEventLakeRow,
  type TimelineParticipantFrameLakeRow,
  RiotMatchIdSchema,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { duckDbColumnsSpec } from "#src/report-lake/schema.ts";
import {
  buildDirPath,
  ensureLakeScaffold,
  publishBuild,
} from "#src/report-lake/paths.ts";
import {
  matchStagingFilePath,
  matchTeamBanStagingFilePath,
  matchTeamStagingFilePath,
  prematchStagingFilePath,
  timelineStagingFilePath,
} from "#src/report-lake/staging.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import { resolveLakeFiles, type LakeFiles } from "#src/reports/duckdb/lake.ts";
import {
  matchRowFromFact,
  prematchRowFromFact,
  teamRowFromFacts,
  type TestLakeMatchFact,
  type TestLakePrematchFact,
} from "#src/testing/report-lake/rows.ts";

/**
 * Test helper: build a minimal report lake from simplified fact inputs.
 *
 * Accounts land in a published build (the engine only reads the accounts
 * dimension from parquet); match/prematch rows land as staging NDJSON, which
 * exercises the union path. Parquet match data is covered by the compactor
 * integration tests and the parity suite (which seeds via full compaction).
 */

let testBuildCounter = 0;

/** Wipe every build and staging file so tests start from an empty lake. */
export async function resetTestLake(lakeDir: string): Promise<void> {
  await rm(lakeDir, { recursive: true, force: true });
  await ensureLakeScaffold(lakeDir);
}

type TestLakeInput = {
  serverId: DiscordGuildId;
  matchFacts?: TestLakeMatchFact[];
  prematchFacts?: TestLakePrematchFact[];
  /** Additional servers that also track every account above. */
  alsoTrackedBy?: string[];
  /** Full-match participants deliberately absent from the accounts dimension. */
  untrackedMatchFacts?: TestLakeMatchFact[];
  timelineEvents?: TimelineEventLakeRow[];
  timelineEventParticipants?: TimelineEventParticipantLakeRow[];
  timelineFrames?: TimelineParticipantFrameLakeRow[];
  timelineCoverage?: TimelineCoverageLakeRow[];
  /** Raw ban rows, written as staging files one per match. */
  bans?: MatchTeamBanLakeRow[];
};

async function writeTestAccounts(
  lakeDir: string,
  input: TestLakeInput,
): Promise<void> {
  // Accounts dimension: one account per distinct (server, playerId, puuid).
  const accountsByKey = new Map<string, AccountLakeRow>();
  const allFacts = [
    ...(input.matchFacts ?? []),
    ...(input.prematchFacts ?? []),
  ];
  const accountServerIds = [input.serverId, ...(input.alsoTrackedBy ?? [])];
  for (const fact of allFacts) {
    for (const serverId of fact.accountServerIds ?? accountServerIds) {
      const key = `${serverId}:${fact.playerId.toString()}:${fact.puuid}`;
      accountsByKey.set(key, {
        server_id: serverId,
        puuid: fact.puuid,
        account_id: fact.playerId,
        account_alias: fact.accountAlias ?? fact.playerAlias,
        region: "AMERICA_NORTH",
        player_id: fact.playerId,
        player_alias: fact.playerAlias,
        discord_id: fact.discordId ?? null,
      });
    }
  }

  testBuildCounter += 1;
  const buildId = `test-${testBuildCounter.toString().padStart(4, "0")}`;
  const buildDir = buildDirPath(lakeDir, buildId);
  const accountsDir = path.join(buildDir, "accounts");
  await mkdir(accountsDir, { recursive: true });

  const accountsNdjson = path.join(buildDir, "accounts.ndjson.tmp");
  await Bun.write(
    accountsNdjson,
    [...accountsByKey.values()].map((row) => JSON.stringify(row)).join("\n") +
      "\n",
  );
  await withDuckDBConnection(async (session) => {
    await session.run(
      `COPY (SELECT * FROM read_json($1, format='newline_delimited', columns=${duckDbColumnsSpec(ACCOUNT_LAKE_COLUMNS)})) TO '${path.join(accountsDir, "accounts.parquet")}' (FORMAT PARQUET)`,
      [accountsNdjson],
    );
  });
  await rm(accountsNdjson);
  await publishBuild(lakeDir, buildId);
}

async function writeTestMatches(
  lakeDir: string,
  input: TestLakeInput,
): Promise<void> {
  // Match rows: one staging file per matchId (exercises the union path).
  // Untracked facts are written alongside tracked ones — the lake makes no
  // distinction; only the accounts dimension above does.
  const byMatch = new Map<string, MatchLakeRow[]>();
  for (const fact of [
    ...(input.matchFacts ?? []),
    ...(input.untrackedMatchFacts ?? []),
  ]) {
    const rows = byMatch.get(fact.matchId) ?? [];
    rows.push(matchRowFromFact(fact));
    byMatch.set(fact.matchId, rows);
  }
  for (const [matchId, rows] of byMatch) {
    await Bun.write(
      matchStagingFilePath(lakeDir, RiotMatchIdSchema.parse(matchId)),
      rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    );
  }
}

async function writeTestMatchTeams(
  lakeDir: string,
  input: TestLakeInput,
): Promise<void> {
  const byMatch = new Map<string, Map<number, TestLakeMatchFact[]>>();
  for (const fact of [
    ...(input.matchFacts ?? []),
    ...(input.untrackedMatchFacts ?? []),
  ]) {
    const teams = byMatch.get(fact.matchId) ?? new Map();
    const teamId = fact.teamId ?? 100;
    const facts = teams.get(teamId) ?? [];
    facts.push(fact);
    teams.set(teamId, facts);
    byMatch.set(fact.matchId, teams);
  }
  for (const [matchId, teams] of byMatch) {
    const rows = [...teams.entries()]
      .toSorted(([left], [right]) => left - right)
      .map(([teamId, facts]) =>
        teamRowFromFacts(RiotMatchIdSchema.parse(matchId), teamId, facts),
      );
    await Bun.write(
      matchTeamStagingFilePath(lakeDir, RiotMatchIdSchema.parse(matchId)),
      rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    );
  }
}

async function writeTestPrematches(
  lakeDir: string,
  input: TestLakeInput,
): Promise<void> {
  const byPrematch = new Map<string, PrematchLakeRow[]>();
  for (const fact of input.prematchFacts ?? []) {
    const rows = byPrematch.get(fact.dedupeKey) ?? [];
    rows.push(prematchRowFromFact(fact));
    byPrematch.set(fact.dedupeKey, rows);
  }
  for (const [dedupeKey, rows] of byPrematch) {
    await Bun.write(
      prematchStagingFilePath(lakeDir, dedupeKey),
      rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    );
  }
}

async function writeTestTimelineRows(
  lakeDir: string,
  table:
    | "timeline_events"
    | "timeline_event_participants"
    | "timeline_participant_frames"
    | "timeline_coverage",
  rows: { match_id: string }[],
): Promise<void> {
  const rowsByMatch = new Map<string, { match_id: string }[]>();
  for (const row of rows) {
    const matchRows = rowsByMatch.get(row.match_id) ?? [];
    matchRows.push(row);
    rowsByMatch.set(row.match_id, matchRows);
  }
  for (const [matchId, matchRows] of rowsByMatch) {
    await Bun.write(
      timelineStagingFilePath(lakeDir, table, RiotMatchIdSchema.parse(matchId)),
      matchRows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    );
  }
}

async function writeTestMatchTeamBans(
  lakeDir: string,
  input: TestLakeInput,
): Promise<void> {
  const byMatch = new Map<string, MatchTeamBanLakeRow[]>();
  for (const row of input.bans ?? []) {
    const rows = byMatch.get(row.match_id) ?? [];
    rows.push(row);
    byMatch.set(row.match_id, rows);
  }
  for (const [matchId, rows] of byMatch) {
    await Bun.write(
      matchTeamBanStagingFilePath(lakeDir, RiotMatchIdSchema.parse(matchId)),
      rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    );
  }
}

export async function writeTestLake(
  lakeDir: string,
  input: TestLakeInput,
): Promise<void> {
  await ensureLakeScaffold(lakeDir);
  await writeTestAccounts(lakeDir, input);
  await writeTestMatches(lakeDir, input);
  await writeTestMatchTeams(lakeDir, input);
  await writeTestMatchTeamBans(lakeDir, input);
  await writeTestPrematches(lakeDir, input);
  await writeTestTimelineRows(
    lakeDir,
    "timeline_events",
    input.timelineEvents ?? [],
  );
  await writeTestTimelineRows(
    lakeDir,
    "timeline_event_participants",
    input.timelineEventParticipants ?? [],
  );
  await writeTestTimelineRows(
    lakeDir,
    "timeline_participant_frames",
    input.timelineFrames ?? [],
  );
  await writeTestTimelineRows(
    lakeDir,
    "timeline_coverage",
    input.timelineCoverage ?? [],
  );
}

/** Write a test lake into a fresh temp directory and resolve its files. */
export async function writeTempTestLake(
  prefix: string,
  input: TestLakeInput,
): Promise<LakeFiles> {
  const lakeDir = await mkdtemp(path.join(tmpdir(), prefix));
  await writeTestLake(lakeDir, input);
  return await resolveLakeFiles(lakeDir);
}
