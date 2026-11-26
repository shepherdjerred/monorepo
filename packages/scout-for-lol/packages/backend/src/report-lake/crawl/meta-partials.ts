import { mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { CRAWL_QUEUE_IDS } from "#src/league/crawl/crawl-config.ts";
import {
  ingestDayDirName,
  type CrawlLakeTable,
} from "#src/report-lake/crawl/crawl-lake-schema.ts";
import { withMaintenanceDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import { PARQUET_COPY_OPTIONS } from "#src/reports/duckdb/writes/parquet.ts";

/**
 * Daily partial aggregates over one ingest day of crawl data.
 *
 * ```
 * <build>/meta_partials_crawl/ingest_day=YYYY-MM-DD/partials-v<N>-<buildId>.parquet
 * ```
 *
 * Why a sibling table partitioned by ingest day, in the build:
 *
 * - Retention, carry-over and erasure already work a day at a time. A partial
 *   that lives in its day's directory is dropped by the same `rm` that drops
 *   the day, hardlinked into the next build with the day, and re-derived from
 *   the rewritten crawl files when erasure touches the day, so it cannot
 *   outlive the rows it was counted from.
 * - It is deliberately not one of the `CRAWL_LAKE_TABLES`: those are covered
 *   by the crawl schema fingerprint and unioned into global-scope Explore
 *   reads, and a partial is neither a match row nor queryable by ScoutQL.
 * - Counts are additive across days (`games`, `wins`), so the roll-up is a
 *   plain sum over the retained days; no pass re-reads a match row.
 *
 * The file name carries `META_PARTIALS_VERSION`: a day whose partials are at
 * an older definition counts as missing and is re-derived the same night.
 *
 * One long table, one row per (kind, patch, queue, rank tier, role, champion,
 * key1, key2):
 *
 * | kind          | champion_id   | key1                       | key2                |
 * | ------------- | ------------- | -------------------------- | ------------------- |
 * | matches       | 0             | -                          | -                   |
 * | champion      | picked        | champion name              | -                   |
 * | ban           | banned        | -                          | -                   |
 * | item          | picked        | item id (final inventory)  | -                   |
 * | start_items   | picked        | `1055+2003x2`              | -                   |
 * | build_path    | picked        | `3031>3006>3036`           | -                   |
 * | rune          | picked        | `style:p0,p1,p2,p3`        | `style:s0,s1`       |
 * | spells        | picked        | `4,12`                     | -                   |
 * | skill_order   | picked        | `QWE` (max order)          | -                   |
 * | matchup       | picked        | opposing champion id       | -                   |
 * | trait_base    | picked        | -                          | enemy trait         |
 * | item_trait    | picked        | item id                    | enemy trait         |
 * | duration      | picked        | `lt25`, `25to35`, `gt35`   | -                   |
 * | boots         | picked        | boots item id (final)      | -                   |
 * | keystone      | picked        | primary rune 0 id          | -                   |
 * | spell_single  | picked        | one summoner spell id      | -                   |
 * | matchup_spell | picked        | opposing champion id       | `4,12` (own pair)   |
 *
 * `games` is the number of participants (matches, for `matches` and `ban`)
 * and `wins` how many of them won. A match is counted only when it is a
 * Summoner's Rift crawl queue with a complete record, a patch, and no
 * augments: Arena, Brawl, League Classic, ARAM Mayhem and any other
 * augment mode are excluded by the queue allowlist and, again, by the
 * augment columns. The rank tier is the visited player's, not every
 * participant's (see `crawl-lake-schema.ts`).
 */

export const META_PARTIALS_TABLE = "meta_partials_crawl";
/**
 * 2 added `duration`, `boots`, `keystone`, `spell_single` and `matchup_spell`.
 * Bumping it makes every retained day's v1 file count as missing, so the next
 * nightly rebuild re-derives each completed day (`compactCrawlDay`) before the
 * roll-up, which only reads files at this version.
 */
export const META_PARTIALS_VERSION = 2;

export const META_ROLES = [
  "TOP",
  "JUNGLE",
  "MIDDLE",
  "BOTTOM",
  "UTILITY",
] as const;

/** Starting items are everything bought in the first 90 seconds. */
const START_WINDOW_MS = 90_000;

/**
 * Consumables, wards and trinkets that sit in the final inventory without
 * being part of a build. Kept as a short, explicit list: an unknown id is a
 * build item until proven otherwise.
 */
export const NON_CORE_ITEM_IDS: readonly number[] = [
  2003, 2010, 2031, 2033, 2055, 2138, 2139, 2140, 3340, 3363, 3364,
];

/**
 * Summoner's Rift boots, from the Data Dragon items tagged `Boots` on map 11
 * (`meta-pipeline.test.ts` pins this list to it): base boots, the tier-two
 * boots, their tier-three upgrades and Slightly Magical Footwear.
 */
export const BOOTS_ITEM_IDS: readonly number[] = [
  1001, 2422, 3006, 3008, 3009, 3010, 3013, 3020, 3047, 3111, 3117, 3158, 3168,
  3170, 3171, 3173, 3174, 3175, 3176,
];

/** Game length buckets: under 25 minutes, 25 to 35 inclusive, over 35. */
const SHORT_GAME_SECONDS = 25 * 60;
const LONG_GAME_SECONDS = 35 * 60;

/** Enemy damage-profile traits, from the enemy team's magic damage share. */
export const ENEMY_TRAITS = [
  "enemy_ap_heavy",
  "enemy_ad_heavy",
  "enemy_mixed_damage",
] as const;
const AP_HEAVY_SHARE = 0.55;
const AD_HEAVY_SHARE = 0.3;

export const MetaPartialKindSchema = z.enum([
  "matches",
  "champion",
  "ban",
  "item",
  "start_items",
  "build_path",
  "rune",
  "spells",
  "skill_order",
  "matchup",
  "trait_base",
  "item_trait",
  "duration",
  "boots",
  "keystone",
  "spell_single",
  "matchup_spell",
]);
export type MetaPartialKind = z.infer<typeof MetaPartialKindSchema>;

export const META_PARTIAL_COLUMNS = {
  kind: "VARCHAR",
  patch: "VARCHAR",
  queue_id: "INTEGER",
  tier: "VARCHAR",
  role: "VARCHAR",
  champion_id: "INTEGER",
  key1: "VARCHAR",
  key2: "VARCHAR",
  games: "BIGINT",
  wins: "BIGINT",
} as const;

const TIMELINE_TABLE: CrawlLakeTable = "timeline_events_crawl";
const MATCH_TABLE: CrawlLakeTable = "matches_crawl";
const BAN_TABLE: CrawlLakeTable = "match_team_bans_crawl";

const PARTIALS_TIMEOUT_MS = 30 * 60 * 1000;

const sqlQueues = CRAWL_QUEUE_IDS.map((id) => id.toString()).join(", ");
const sqlRoles = META_ROLES.map((role) => `'${role}'`).join(", ");
const sqlNonCore = NON_CORE_ITEM_IDS.map((id) => id.toString()).join(", ");
const sqlBoots = BOOTS_ITEM_IDS.map((id) => id.toString()).join(", ");

export function metaPartialsDayDir(buildDir: string, day: string): string {
  return path.join(buildDir, META_PARTIALS_TABLE, ingestDayDirName(day));
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function listDir(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

/** The `.parquet` files in a directory whose names start with `prefix`, sorted. */
export async function parquetFiles(
  directory: string,
  prefix = "",
): Promise<string[]> {
  const names = await listDir(directory);
  return names
    .filter((name) => name.startsWith(prefix) && name.endsWith(".parquet"))
    .map((name) => path.join(directory, name))
    .toSorted();
}

/** The day's partial files at the current definition. */
export async function currentDayPartialFiles(
  buildDir: string,
  day: string,
): Promise<string[]> {
  return await parquetFiles(
    metaPartialsDayDir(buildDir, day),
    `partials-v${META_PARTIALS_VERSION.toString()}-`,
  );
}

export async function hasCurrentPartials(
  buildDir: string,
  day: string,
): Promise<boolean> {
  const files = await currentDayPartialFiles(buildDir, day);
  return files.length > 0;
}

export async function hasAnyPartials(
  buildDir: string,
  day: string,
): Promise<boolean> {
  const names = await listDir(metaPartialsDayDir(buildDir, day));
  return names.length > 0;
}

export async function removeDayPartials(
  buildDir: string,
  day: string,
): Promise<void> {
  await rm(metaPartialsDayDir(buildDir, day), {
    recursive: true,
    force: true,
  });
}

async function crawlDayFiles(
  buildDir: string,
  table: CrawlLakeTable,
  day: string,
): Promise<string[]> {
  return await parquetFiles(path.join(buildDir, table, ingestDayDirName(day)));
}

const PARTICIPANTS_SQL = String.raw`
CREATE OR REPLACE TEMP TABLE meta_p AS
SELECT match_id, participant_id, team_id, champion_id, champion_name,
  team_position AS role, win,
  regexp_extract(game_version, '^(\d+\.\d+)\.', 1) AS patch,
  queue_id,
  lower(coalesce(bracket_tier, 'unranked')) AS tier,
  [item0, item1, item2, item3, item4, item5] AS items,
  summoner_spell_1_id, summoner_spell_2_id, game_duration_seconds,
  primary_rune_style_id, primary_rune_0_id, primary_rune_1_id,
  primary_rune_2_id, primary_rune_3_id,
  secondary_rune_style_id, secondary_rune_0_id, secondary_rune_1_id,
  magic_damage_dealt_to_champions AS magic_damage,
  physical_damage_dealt_to_champions AS physical_damage,
  true_damage_dealt_to_champions AS true_damage
FROM read_parquet($1, hive_partitioning = false)
WHERE queue_id IN (${sqlQueues})
  AND participant_kind = 'player'
  AND coverage = 'complete'
  AND participant_id IS NOT NULL
  AND game_version IS NOT NULL
  AND regexp_matches(game_version, '^\d+\.\d+\.')
  AND augment_1_id IS NULL AND augment_2_id IS NULL AND augment_3_id IS NULL
  AND augment_4_id IS NULL AND augment_5_id IS NULL AND augment_6_id IS NULL
  AND team_position IN (${sqlRoles})
QUALIFY row_number() OVER (PARTITION BY match_id, participant_id ORDER BY crawled_at) = 1`;

const PREPARE_SQL = [
  `CREATE OR REPLACE TEMP TABLE meta_pi AS
   SELECT DISTINCT match_id, participant_id, team_id, patch, queue_id, tier, role, champion_id, win, item
   FROM (SELECT *, unnest(items) AS item FROM meta_p)
   WHERE item > 0 AND item NOT IN (${sqlNonCore})`,
  `CREATE OR REPLACE TEMP TABLE meta_trait AS
   SELECT match_id, team_id,
     CASE
       WHEN magic_share >= ${AP_HEAVY_SHARE.toString()} THEN 'enemy_ap_heavy'
       WHEN magic_share <= ${AD_HEAVY_SHARE.toString()} THEN 'enemy_ad_heavy'
       ELSE 'enemy_mixed_damage'
     END AS trait
   FROM (
     SELECT match_id, team_id,
       sum(magic_damage) / nullif(sum(magic_damage + physical_damage + true_damage), 0) AS magic_share
     FROM meta_p GROUP BY match_id, team_id
   ) WHERE magic_share IS NOT NULL`,
  // Participant rows joined to the opposing team's trait.
  `CREATE OR REPLACE TEMP TABLE meta_vs AS
   SELECT p.match_id, p.participant_id, p.patch, p.queue_id, p.tier, p.role, p.champion_id, p.win, t.trait
   FROM meta_p p JOIN meta_trait t ON t.match_id = p.match_id AND t.team_id <> p.team_id`,
];

const EVENTS_COLUMNS =
  "match_id VARCHAR, participant_id INTEGER, t BIGINT, event_type VARCHAR, item_id INTEGER, before_id INTEGER, skill_slot INTEGER, level_up_type VARCHAR";

const GROUP = "patch, queue_id, tier, role, champion_id";
const CONTEXT = "p.patch, p.queue_id, p.tier, p.role, p.champion_id";

/** Every branch yields the partial columns in order. */
function partialQueries(): string[] {
  const wins = "sum(CAST(win AS INTEGER))";
  return [
    `SELECT 'matches', patch, queue_id, tier, '', 0, '', '', count(DISTINCT match_id), 0
     FROM meta_p GROUP BY patch, queue_id, tier`,
    `SELECT 'champion', patch, queue_id, tier, role, champion_id, champion_name, '', count(*), ${wins}
     FROM meta_p GROUP BY ${GROUP}, champion_name`,
    `SELECT 'ban', m.patch, m.queue_id, m.tier, '', b.champion_id, '', '', count(DISTINCT b.match_id), 0
     FROM meta_bans b
     JOIN (SELECT DISTINCT match_id, patch, queue_id, tier FROM meta_p) m USING (match_id)
     WHERE b.champion_id > 0
     GROUP BY m.patch, m.queue_id, m.tier, b.champion_id`,
    `SELECT 'item', patch, queue_id, tier, role, champion_id, CAST(item AS VARCHAR), '', count(*), ${wins}
     FROM meta_pi GROUP BY ${GROUP}, item`,
    `SELECT 'trait_base', patch, queue_id, tier, role, champion_id, '', trait, count(*), ${wins}
     FROM meta_vs GROUP BY ${GROUP}, trait`,
    `SELECT 'item_trait', i.patch, i.queue_id, i.tier, i.role, i.champion_id, CAST(i.item AS VARCHAR), v.trait, count(*), sum(CAST(i.win AS INTEGER))
     FROM meta_pi i JOIN meta_vs v ON v.match_id = i.match_id AND v.participant_id = i.participant_id
     GROUP BY i.patch, i.queue_id, i.tier, i.role, i.champion_id, i.item, v.trait`,
    `SELECT 'rune', patch, queue_id, tier, role, champion_id,
       CAST(primary_rune_style_id AS VARCHAR) || ':' || concat_ws(',', primary_rune_0_id, primary_rune_1_id, primary_rune_2_id, primary_rune_3_id),
       CAST(secondary_rune_style_id AS VARCHAR) || ':' || concat_ws(',', secondary_rune_0_id, secondary_rune_1_id),
       count(*), ${wins}
     FROM meta_p
     WHERE primary_rune_style_id IS NOT NULL AND primary_rune_0_id IS NOT NULL
       AND primary_rune_1_id IS NOT NULL AND primary_rune_2_id IS NOT NULL
       AND primary_rune_3_id IS NOT NULL AND secondary_rune_style_id IS NOT NULL
       AND secondary_rune_0_id IS NOT NULL AND secondary_rune_1_id IS NOT NULL
     GROUP BY ${GROUP}, primary_rune_style_id, primary_rune_0_id, primary_rune_1_id, primary_rune_2_id, primary_rune_3_id,
       secondary_rune_style_id, secondary_rune_0_id, secondary_rune_1_id`,
    `SELECT 'spells', patch, queue_id, tier, role, champion_id,
       CAST(least(summoner_spell_1_id, summoner_spell_2_id) AS VARCHAR) || ',' || CAST(greatest(summoner_spell_1_id, summoner_spell_2_id) AS VARCHAR),
       '', count(*), ${wins}
     FROM meta_p GROUP BY ${GROUP}, least(summoner_spell_1_id, summoner_spell_2_id), greatest(summoner_spell_1_id, summoner_spell_2_id)`,
    `SELECT 'duration', patch, queue_id, tier, role, champion_id, length_bucket, '', count(*), ${wins}
     FROM (
       SELECT *, CASE WHEN game_duration_seconds < ${SHORT_GAME_SECONDS.toString()} THEN 'lt25'
                      WHEN game_duration_seconds <= ${LONG_GAME_SECONDS.toString()} THEN '25to35'
                      ELSE 'gt35' END AS length_bucket
       FROM meta_p WHERE game_duration_seconds IS NOT NULL
     ) GROUP BY ${GROUP}, length_bucket`,
    `SELECT 'boots', patch, queue_id, tier, role, champion_id, CAST(item AS VARCHAR), '', count(*), ${wins}
     FROM meta_pi WHERE item IN (${sqlBoots})
     GROUP BY ${GROUP}, item`,
    `SELECT 'keystone', patch, queue_id, tier, role, champion_id, CAST(primary_rune_0_id AS VARCHAR), '', count(*), ${wins}
     FROM meta_p WHERE primary_rune_0_id IS NOT NULL
     GROUP BY ${GROUP}, primary_rune_0_id`,
    `SELECT 'spell_single', patch, queue_id, tier, role, champion_id, CAST(spell AS VARCHAR), '', count(*), ${wins}
     FROM (SELECT *, unnest([summoner_spell_1_id, summoner_spell_2_id]) AS spell FROM meta_p
           WHERE summoner_spell_1_id IS NOT NULL AND summoner_spell_2_id IS NOT NULL)
     GROUP BY ${GROUP}, spell`,
    `SELECT 'matchup_spell', a.patch, a.queue_id, a.tier, a.role, a.champion_id, CAST(b.champion_id AS VARCHAR),
       CAST(least(a.summoner_spell_1_id, a.summoner_spell_2_id) AS VARCHAR) || ',' || CAST(greatest(a.summoner_spell_1_id, a.summoner_spell_2_id) AS VARCHAR),
       count(*), sum(CAST(a.win AS INTEGER))
     FROM meta_p a JOIN meta_p b
       ON a.match_id = b.match_id AND a.role = b.role AND a.team_id <> b.team_id AND a.champion_id <> b.champion_id
     WHERE a.summoner_spell_1_id IS NOT NULL AND a.summoner_spell_2_id IS NOT NULL
     GROUP BY a.patch, a.queue_id, a.tier, a.role, a.champion_id, b.champion_id,
       least(a.summoner_spell_1_id, a.summoner_spell_2_id), greatest(a.summoner_spell_1_id, a.summoner_spell_2_id)`,
    `SELECT 'matchup', a.patch, a.queue_id, a.tier, a.role, a.champion_id, CAST(b.champion_id AS VARCHAR), '', count(*), sum(CAST(a.win AS INTEGER))
     FROM meta_p a JOIN meta_p b
       ON a.match_id = b.match_id AND a.role = b.role AND a.team_id <> b.team_id AND a.champion_id <> b.champion_id
     GROUP BY a.patch, a.queue_id, a.tier, a.role, a.champion_id, b.champion_id`,
    // Starting items: everything bought in the first 90s, net of undone buys.
    `WITH buys AS (
       SELECT match_id, participant_id, item_id, count(*) AS n FROM meta_ev
       WHERE event_type = 'ITEM_PURCHASED' AND t <= ${START_WINDOW_MS.toString()} AND item_id IS NOT NULL
       GROUP BY ALL
     ), undos AS (
       SELECT match_id, participant_id, before_id AS item_id, count(*) AS n FROM meta_ev
       WHERE event_type = 'ITEM_UNDO' AND t <= ${START_WINDOW_MS.toString()} AND before_id IS NOT NULL
       GROUP BY ALL
     ), net AS (
       SELECT b.match_id, b.participant_id, b.item_id, b.n - coalesce(u.n, 0) AS n
       FROM buys b LEFT JOIN undos u USING (match_id, participant_id, item_id)
       WHERE b.n - coalesce(u.n, 0) > 0
     ), keyed AS (
       SELECT match_id, participant_id,
         string_agg(CAST(item_id AS VARCHAR) || CASE WHEN n > 1 THEN 'x' || CAST(n AS INTEGER) ELSE '' END, '+' ORDER BY item_id) AS key
       FROM net GROUP BY match_id, participant_id
     )
     SELECT 'start_items', ${CONTEXT}, k.key, '', count(*), sum(CAST(p.win AS INTEGER))
     FROM keyed k JOIN meta_p p USING (match_id, participant_id)
     GROUP BY p.patch, p.queue_id, p.tier, p.role, p.champion_id, k.key`,
    // Build path: the first three items bought that were still held at the end.
    `WITH firsts AS (
       SELECT match_id, participant_id, item_id, min(t) AS first_t FROM meta_ev
       WHERE event_type = 'ITEM_PURCHASED' AND item_id IS NOT NULL
       GROUP BY ALL
     ), ordered AS (
       SELECT f.match_id, f.participant_id, f.item_id,
         row_number() OVER (PARTITION BY f.match_id, f.participant_id ORDER BY f.first_t, f.item_id) AS rn
       FROM firsts f JOIN meta_pi i
         ON i.match_id = f.match_id AND i.participant_id = f.participant_id AND i.item = f.item_id
     ), keyed AS (
       SELECT match_id, participant_id,
         string_agg(CAST(item_id AS VARCHAR), '>' ORDER BY rn) AS key
       FROM ordered WHERE rn <= 3 GROUP BY match_id, participant_id HAVING count(*) = 3
     )
     SELECT 'build_path', ${CONTEXT}, k.key, '', count(*), sum(CAST(p.win AS INTEGER))
     FROM keyed k JOIN meta_p p USING (match_id, participant_id)
     GROUP BY p.patch, p.queue_id, p.tier, p.role, p.champion_id, k.key`,
    // Skill order: Q/W/E ranked by points put in, ties by first level.
    `WITH points AS (
       SELECT match_id, participant_id, skill_slot, count(*) AS n, min(t) AS first_t FROM meta_ev
       WHERE event_type = 'SKILL_LEVEL_UP' AND level_up_type = 'NORMAL' AND skill_slot IN (1, 2, 3)
       GROUP BY ALL
     ), keyed AS (
       SELECT match_id, participant_id,
         string_agg(CASE skill_slot WHEN 1 THEN 'Q' WHEN 2 THEN 'W' ELSE 'E' END, '' ORDER BY n DESC, first_t) AS key
       FROM points GROUP BY match_id, participant_id HAVING count(*) = 3 AND sum(n) >= 9
     )
     SELECT 'skill_order', ${CONTEXT}, k.key, '', count(*), sum(CAST(p.win AS INTEGER))
     FROM keyed k JOIN meta_p p USING (match_id, participant_id)
     GROUP BY p.patch, p.queue_id, p.tier, p.role, p.champion_id, k.key`,
  ];
}

const PartialCountSchema = z
  .object({ Count: z.union([z.bigint(), z.number()]) })
  .transform((row) => Number(row.Count));

/**
 * Derive one ingest day's partials from the build's crawl files, replacing
 * whatever partials the build held for the day. A day with no crawl matches
 * has no partials. Idempotent: the same crawl files give the same rows.
 *
 * Reads the build's files as they are now, so erased matches already absent
 * from the crawl tables are absent from the partials; callers re-run this for
 * every day whose crawl files they rewrite.
 */
export async function writeDayPartials(input: {
  buildDir: string;
  buildId: string;
  day: string;
  abortSignal?: AbortSignal | undefined;
}): Promise<{ rows: number }> {
  const matchFiles = await crawlDayFiles(
    input.buildDir,
    MATCH_TABLE,
    input.day,
  );
  if (matchFiles.length === 0) {
    await removeDayPartials(input.buildDir, input.day);
    return { rows: 0 };
  }
  const eventFiles = await crawlDayFiles(
    input.buildDir,
    TIMELINE_TABLE,
    input.day,
  );
  const banFiles = await crawlDayFiles(input.buildDir, BAN_TABLE, input.day);
  const staged = path.join(
    input.buildDir,
    `.partials-${input.day}-${input.buildId}.parquet`,
  );
  const rows = await withMaintenanceDuckDBConnection(
    async (session) => {
      await session.run(PARTICIPANTS_SQL, [session.list(matchFiles)]);
      await session.run(
        banFiles.length === 0
          ? "CREATE OR REPLACE TEMP TABLE meta_bans (match_id VARCHAR, team_id INTEGER, champion_id INTEGER)"
          : "CREATE OR REPLACE TEMP TABLE meta_bans AS SELECT match_id, team_id, champion_id FROM read_parquet($1, hive_partitioning = false)",
        banFiles.length === 0 ? [] : [session.list(banFiles)],
      );
      await session.run(
        eventFiles.length === 0
          ? `CREATE OR REPLACE TEMP TABLE meta_ev (${EVENTS_COLUMNS})`
          : "CREATE OR REPLACE TEMP TABLE meta_ev AS SELECT match_id, participant_id, event_timestamp_ms AS t, event_type, item_id, before_id, skill_slot, level_up_type FROM read_parquet($1, hive_partitioning = false)",
        eventFiles.length === 0 ? [] : [session.list(eventFiles)],
      );
      for (const statement of PREPARE_SQL) await session.run(statement);
      input.abortSignal?.throwIfAborted();
      const columns = Object.entries(META_PARTIAL_COLUMNS)
        .map(([name, type]) => `CAST(${name} AS ${type}) AS ${name}`)
        .join(", ");
      const union = partialQueries()
        .map((query) => `SELECT * FROM (${query})`)
        .join("\nUNION ALL\n");
      const counted = await session.run(
        `COPY (SELECT ${columns} FROM (SELECT * FROM (${union}) AS u(${Object.keys(META_PARTIAL_COLUMNS).join(", ")})) ORDER BY kind, patch, queue_id, tier, role, champion_id, key1, key2) TO '${staged.replaceAll("'", "''")}' (${PARQUET_COPY_OPTIONS})`,
      );
      return PartialCountSchema.parse(counted[0]);
    },
    {
      timeoutMs: PARTIALS_TIMEOUT_MS,
      ...(input.abortSignal === undefined
        ? {}
        : { abortSignal: input.abortSignal }),
    },
  );
  // Replace the day's files only now the new ones exist. The old files are
  // hardlinks shared with the published build, so they are unlinked here and
  // never rewritten.
  const directory = metaPartialsDayDir(input.buildDir, input.day);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  await rename(
    staged,
    path.join(
      directory,
      `partials-v${META_PARTIALS_VERSION.toString()}-${input.buildId}.parquet`,
    ),
  );
  return { rows };
}
