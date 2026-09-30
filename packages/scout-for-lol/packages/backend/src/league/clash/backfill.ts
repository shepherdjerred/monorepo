import { z } from "zod";
import {
  ClashCupQueueSchema,
  LeaguePuuidSchema,
  PlatformRouteSchema,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { clashSnapshotEnabledGuildIds } from "#src/league/clash/access.ts";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import { bindParams } from "#src/reports/duckdb/lake-reads.ts";
import {
  buildMatchesSource,
  buildPrematchSource,
  listParam,
  resolveLakeFiles,
  scalarParam,
  type SqlFragment,
} from "#src/reports/duckdb/lake.ts";
import {
  upsertClashGameSighting,
  type ClashSightingWrite,
} from "#src/league/clash/sighting.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("clash-backfill");

const LakeIntSchema = z.union([z.bigint(), z.number()]).transform(Number);

const LakeClashRowSchema = z.object({
  platform_id: z.string(),
  game_id: z.string(),
  puuid: z.string(),
  queue: z.string().nullable(),
  champion_id: LakeIntSchema,
  team_id: LakeIntSchema,
  observed_ms: LakeIntSchema,
  win: z
    .boolean()
    .nullish()
    .transform((value) => value ?? null),
  source: z.enum(["prematch", "match"]),
});

type LakeClashRow = z.infer<typeof LakeClashRowSchema>;

export function clashLakeSightingKey(row: {
  platform: string;
  gameId: string;
  puuid: string;
}): string {
  return `${row.platform}:${row.gameId}:${row.puuid}`;
}

export function clashLakeRowsMissingFromSightings(
  rows: readonly LakeClashRow[],
  existing: readonly {
    platform: string;
    gameId: string;
    puuid: string;
    source: string;
  }[],
): LakeClashRow[] {
  const seen = new Map(
    existing.map((row) => [clashLakeSightingKey(row), row.source]),
  );
  return rows.filter((row) => {
    const existingSource = seen.get(
      clashLakeSightingKey({
        platform: row.platform_id,
        gameId: row.game_id,
        puuid: row.puuid,
      }),
    );
    return (
      existingSource === undefined ||
      (existingSource === "prematch" && row.source === "match")
    );
  });
}

export function clashSightingWriteFromLake(
  row: LakeClashRow,
): ClashSightingWrite {
  return {
    platform: PlatformRouteSchema.parse(row.platform_id),
    gameId: row.game_id,
    puuid: LeaguePuuidSchema.parse(row.puuid),
    source: row.source,
    queue: ClashCupQueueSchema.parse(row.queue),
    championId: row.champion_id,
    teamId: row.team_id,
    observedAt: new Date(row.observed_ms),
    win: row.source === "match" ? row.win : null,
  };
}

export async function backfillClashSightingsFromLake(): Promise<number> {
  const enabledGuildIds = await clashSnapshotEnabledGuildIds();
  if (enabledGuildIds.length === 0) {
    return 0;
  }
  const accounts = await prisma.account.findMany({
    where: { serverId: { in: enabledGuildIds } },
    distinct: ["puuid"],
    select: { puuid: true },
  });
  const puuids = accounts.map((account) => account.puuid);
  if (puuids.length === 0) {
    return 0;
  }
  const existing = await prisma.clashGameSighting.findMany({
    select: { platform: true, gameId: true, puuid: true, source: true },
  });
  const rows = clashLakeRowsMissingFromSightings(
    await loadClashLakeRows(puuids),
    existing,
  );
  let written = 0;
  for (const row of rows) {
    await upsertClashGameSighting(clashSightingWriteFromLake(row));
    written += 1;
  }
  logger.info(`Clash lake backfill upserted ${written.toString()} sightings`);
  return written;
}

async function loadClashLakeRows(puuids: string[]): Promise<LakeClashRow[]> {
  const files = await resolveLakeFiles(resolveLakeDir());
  const prematch = buildPrematchSource(files, {
    sql: "puuid IN (SELECT unnest(?)) AND queue IN (SELECT unnest(?))",
    params: [listParam(puuids), listParam(["clash", "aram clash"])],
  });
  const matches = buildMatchesSource(files, {
    sql: "puuid IN (SELECT unnest(?)) AND queue = ?",
    params: [listParam(puuids), scalarParam("clash")],
  });
  const rows: LakeClashRow[] = [];
  if (prematch !== undefined) {
    rows.push(
      ...(await queryClashLake({
        source: prematch,
        sql:
          `SELECT platform_id, game_id, puuid, queue, champion_id, team_id, ` +
          `COALESCE(epoch_ms(game_start_at), epoch_ms(observed_at))::BIGINT AS observed_ms, ` +
          `NULL AS win, 'prematch' AS source FROM (${prematch.sql})`,
      })),
    );
  }
  if (matches !== undefined) {
    rows.push(
      ...(await queryClashLake({
        source: matches,
        sql:
          `SELECT platform_id, game_id, puuid, queue, champion_id, team_id, ` +
          `epoch_ms(game_start_at)::BIGINT AS observed_ms, win, 'match' AS source ` +
          `FROM (${matches.sql})`,
      })),
    );
  }
  return rows;
}

async function queryClashLake(input: {
  source: SqlFragment;
  sql: string;
}): Promise<LakeClashRow[]> {
  return await withDuckDBConnection(async (session) => {
    const raw = await session.run(
      input.sql,
      bindParams(session, input.source.params),
    );
    return raw.map((row) => LakeClashRowSchema.parse(row));
  });
}
