import path from "node:path";
import { z } from "zod";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import {
  StageDatasetPinSchema,
  replayEnvironmentIssues,
} from "#src/explore/replay/dataset.ts";
import {
  RecoveryOracleSchema,
  recoveryAssertions,
} from "#src/explore/replay/recovery-assertions.ts";
import {
  ReplayManifestSchema,
  ReplayCaseCandidateSchema,
  writeBundleFile,
} from "#src/explore/replay/bundle.ts";

// This deliberately uses SQL windows over the pinned Parquet, independently of
// the agent's ScoutQL selection and generated JavaScript.
const [pinFile, ...bundles] = Bun.argv.slice(2);
if (pinFile === undefined || bundles.length === 0)
  throw new Error(
    "Usage: bun scripts/explore-replay/check-recovery.ts <dataset.json> <bundleDir>...",
  );
const pin = StageDatasetPinSchema.parse(await Bun.file(pinFile).json());
const environmentIssues = replayEnvironmentIssues({
  pin,
  environment: Bun.env,
  resolvedLakeDir: Bun.env["REPORT_LAKE_DIR"] ?? "",
});
if (environmentIssues.length > 0) throw new Error(environmentIssues.join("\n"));
Bun.env["TEMPORAL_NAMESPACE"] ??= pin.stage;
delete Bun.env["TEMPORAL_ADDRESS"];
const { prisma } = await import("#src/database/index.ts");
const { withDuckDBConnection, closeDuckDB } =
  await import("#src/reports/duckdb/instance.ts");
const { databaseSnapshotId } = await import("./snapshot-identity.ts");
if ((await databaseSnapshotId()) !== pin.database.snapshotId)
  throw new Error("Oracle database differs from the pin");
const build = path.join(pin.lake.dir, "builds", pin.lake.buildId);
const accounts = await prisma.account.findMany({
  where: { serverId: DiscordGuildIdSchema.parse("1549825645851312168") },
  select: { puuid: true, playerId: true, player: { select: { alias: true } } },
});
const identities = accounts.map((account) => ({
  puuid: account.puuid,
  player_id: account.playerId,
  alias: account.player.alias,
}));
const oracle = await withDuckDBConnection(async (session) => {
  await session.run(
    `CREATE TEMP TABLE identities AS SELECT (value->>'puuid') AS puuid, (value->>'player_id') AS player_id, (value->>'alias') AS alias FROM json_each($1::JSON)`,
    [JSON.stringify(identities)],
  );
  await session.run(
    `CREATE TEMP TABLE games AS SELECT DISTINCT i.player_id, i.alias, m.match_id, m.game_end_at, m.win FROM read_parquet($1) m JOIN identities i USING (puuid)`,
    [path.join(build, "matches/**/*.parquet")],
  );
  const streaks = z
    .array(z.object({ alias: z.string(), wins: z.number() }))
    .min(1)
    .parse(
      await session.run(
        `WITH ordered AS (SELECT *, SUM(CASE WHEN win THEN 0 ELSE 1 END) OVER (PARTITION BY player_id ORDER BY game_end_at, match_id ROWS UNBOUNDED PRECEDING) AS loss_group FROM games), streaks AS (SELECT player_id, alias, count(*)::DOUBLE AS wins FROM ordered WHERE win GROUP BY player_id, alias, loss_group) SELECT DISTINCT alias, wins FROM streaks WHERE wins=(SELECT MAX(wins) FROM streaks)`,
      ),
    );
  const matchId = "EUW1_7994369404";
  const participants = z
    .array(
      z.object({
        participant_id: z.number(),
        team_id: z.number(),
        champion_name: z.string(),
        kills: z.number(),
        deaths: z.number(),
        assists: z.number(),
        creep_score: z.number(),
        gold_earned: z.number(),
        total_damage_dealt_to_champions: z.number(),
      }),
    )
    .parse(
      await session.run(
        "SELECT participant_id, team_id, champion_name, kills, deaths, assists, creep_score, gold_earned, total_damage_dealt_to_champions FROM read_parquet($1) WHERE match_id=$2",
        [path.join(build, "matches/**/*.parquet"), matchId],
      ),
    );
  const target = participants.find((p) => p.champion_name === "Ezreal");
  if (target === undefined) throw new Error("Ezreal fixture missing");
  const kills = z
    .array(z.object({ killer_id: z.number(), event_timestamp_ms: z.number() }))
    .parse(
      await session.run(
        "SELECT killer_id, event_timestamp_ms::DOUBLE AS event_timestamp_ms FROM read_parquet($1) WHERE match_id=$2 AND event_type='CHAMPION_KILL' AND victim_id=$3 ORDER BY event_timestamp_ms, event_id",
        [
          path.join(build, "timeline_events/**/*.parquet"),
          matchId,
          target.participant_id,
        ],
      ),
    );
  return RecoveryOracleSchema.parse({
    buildId: pin.lake.buildId,
    streak: { wins: streaks[0]?.wins, winners: streaks.map((s) => s.alias) },
    game: {
      matchId,
      kda: [target.kills, target.deaths, target.assists],
      creepScore: target.creep_score,
      gold: target.gold_earned,
      damage: target.total_damage_dealt_to_champions,
      deathEvents: kills.map((event) => {
        const killer = participants.find(
          (p) => p.participant_id === event.killer_id,
        );
        if (killer === undefined)
          throw new Error("Death event has no recorded killer identity");
        return {
          timestampMs: event.event_timestamp_ms,
          killer: killer.champion_name,
        };
      }),
      killers: participants
        .filter((p) => kills.some((k) => k.killer_id === p.participant_id))
        .map((p) => p.champion_name),
      teammates: participants
        .filter(
          (p) =>
            p.team_id === target.team_id &&
            p.participant_id !== target.participant_id,
        )
        .map((p) => p.champion_name),
    },
  });
});
const required = ["conv:3c004891:0", "conv:507d822f:2"];
const seen = new Set<string>();
let failed = false;
for (const bundle of bundles) {
  const manifest = ReplayManifestSchema.parse(
    await Bun.file(path.join(bundle, "manifest.json")).json(),
  );
  if (
    manifest.lake.buildId !== oracle.buildId ||
    manifest.database.snapshotId !== pin.database.snapshotId
  )
    throw new Error("Bundle and oracle datasets differ");
  const checks = [];
  for (const caseId of required) {
    const file = Bun.file(
      path.join(bundle, "cases", `${caseId.replaceAll(":", "_")}.json`),
    );
    if (!(await file.exists())) continue;
    seen.add(caseId);
    const record = z
      .object({
        candidate: ReplayCaseCandidateSchema,
        error: z.unknown().nullable(),
      })
      .parse(await file.json());
    const issues = recoveryAssertions(caseId, record.candidate, oracle);
    if (record.error !== null) issues.push("turn_failed");
    if (issues.length > 0) failed = true;
    checks.push({ caseId, issues });
  }
  await writeBundleFile(
    path.join(bundle, "recovery-checks.json"),
    JSON.stringify({ oracle, checks }, null, 2),
  );
  console.log(JSON.stringify({ bundle, checks }));
}
if (required.some((caseId) => !seen.has(caseId)))
  throw new Error("Both recovery cases are required");
await prisma.$disconnect();
await closeDuckDB();
process.exitCode = failed ? 1 : 0;
