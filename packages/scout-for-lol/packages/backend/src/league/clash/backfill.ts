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
  withLakeQueryRetry,
  type SqlFragment,
} from "#src/reports/duckdb/lake.ts";
import {
  mergeClashAliasSightings,
  upsertClashGameSighting,
  type ClashSightingWrite,
} from "#src/league/clash/sighting.ts";
import {
  canonicalClashGameIds,
  claimClashGameAlias,
  clashCanonicalMatchId,
  clashGameKey,
  recordClashGameIdentity,
} from "#src/league/clash/identity.ts";
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
    .transform((value = null) => value),
  source: z.enum(["prematch", "match"]),
});

type LakeClashRow = z.infer<typeof LakeClashRowSchema>;

export function clashLakeSightingKey(row: {
  platform: string;
  gameId: string;
  /** Lake rows carry every participant's raw puuid, not only tracked ones. */
  puuid: LakeClashRow["puuid"];
}): string {
  return `${row.platform}:${row.gameId}:${row.puuid}`;
}

export function clashLakeRowsMissingFromSightings(
  rows: readonly LakeClashRow[],
  existing: readonly {
    platform: string;
    gameId: string;
    puuid: LakeClashRow["puuid"];
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
  await backfillClashIdentitiesFromLake();
  const merged = await mergeClashAliasSightings();
  if (merged > 0)
    logger.info(
      `Clash alias merge folded ${merged.toString()} duplicate sightings`,
    );
  const existing = await prisma.clashGameSighting.findMany({
    select: { platform: true, gameId: true, puuid: true, source: true },
  });
  const lakeRows = await loadClashLakeRows(puuids);
  const canonical = await canonicalClashGameIds(
    lakeRows.map((row) => ({ platform: row.platform_id, gameId: row.game_id })),
  );
  const rows = clashLakeRowsMissingFromSightings(
    lakeRows.map((row) => ({
      ...row,
      game_id:
        canonical.get(
          clashGameKey({ platform: row.platform_id, gameId: row.game_id }),
        ) ?? row.game_id,
    })),
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
  return await withLakeQueryRetry(resolveLakeDir(), async (files) => {
    const prematch = buildPrematchSource(files, {
      sql: "puuid IN (SELECT unnest(?)) AND queue IN (SELECT unnest(?))",
      params: [listParam(puuids), listParam(["clash", "aram clash"])],
    });
    const matches = buildMatchesSource(files, {
      sql: "puuid IN (SELECT unnest(?)) AND queue IN (SELECT unnest(?))",
      params: [listParam(puuids), listParam(["clash", "aram clash"])],
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
  });
}

const LakeClashGameSchema = z.object({
  platform_id: z.string(),
  game_id: z.string(),
  queue_id: LakeIntSchema,
  start_ms: LakeIntSchema,
  teams: z.array(LakeIntSchema),
  champions: z.array(LakeIntSchema),
});

type LakeClashGame = z.infer<typeof LakeClashGameSchema>;

export function clashGameFromLake(row: LakeClashGame) {
  return {
    platform: row.platform_id,
    gameId: row.game_id,
    queueId: row.queue_id,
    startAt: new Date(row.start_ms),
    participants: row.teams.map((teamId, index) => {
      const championId = row.champions[index];
      if (championId === undefined)
        throw new Error(
          `Lake game ${row.game_id} lists unequal teams and champions`,
        );
      return { teamId, championId };
    }),
  };
}

/**
 * Rebuild Clash identities from the lake, so games archived before
 * `ClashGameIdentity` existed get one, and Riot's published games already
 * in the lake are aliased to them. Both writes are idempotent.
 */
async function backfillClashIdentitiesFromLake(): Promise<void> {
  const { prematch, matches } = await loadClashLakeGames();
  for (const row of prematch)
    await recordClashGameIdentity(clashGameFromLake(row));
  for (const row of matches) {
    const game = clashGameFromLake(row);
    // Already processed under its own id: the alias joins history only.
    await claimClashGameAlias(clashCanonicalMatchId(game), game, {
      claimProcessing: false,
    });
  }
}

function selectClashGames(start: string): string {
  return (
    `SELECT platform_id, game_id, any_value(queue_id) AS queue_id, ` +
    `min(${start})::BIGINT AS start_ms, ` +
    `list(team_id ORDER BY team_id, champion_id) AS teams, ` +
    `list(champion_id ORDER BY team_id, champion_id) AS champions`
  );
}

async function loadClashLakeGames(): Promise<{
  prematch: LakeClashGame[];
  matches: LakeClashGame[];
}> {
  return await withLakeQueryRetry(resolveLakeDir(), async (files) => {
    const filter = {
      sql: "queue IN (SELECT unnest(?))",
      params: [listParam(["clash", "aram clash"])],
    };
    const prematch = buildPrematchSource(files, filter);
    const matches = buildMatchesSource(files, filter);
    return {
      prematch:
        prematch === undefined
          ? []
          : await queryClashGames(
              prematch,
              `${selectClashGames("COALESCE(epoch_ms(game_start_at), epoch_ms(observed_at))")} ` +
                `FROM (${prematch.sql}) GROUP BY platform_id, game_id`,
            ),
      matches:
        matches === undefined
          ? []
          : await queryClashGames(
              matches,
              `${selectClashGames("epoch_ms(game_start_at)")} ` +
                `FROM (${matches.sql}) GROUP BY platform_id, game_id`,
            ),
    };
  });
}

async function queryClashGames(
  source: SqlFragment,
  sql: string,
): Promise<LakeClashGame[]> {
  return await withDuckDBConnection(async (session) => {
    const raw = await session.run(sql, bindParams(session, source.params));
    return raw.map((row) => LakeClashGameSchema.parse(row));
  });
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
