import path from "node:path";
import { z } from "zod";
import { duckDbColumnsSpec } from "#src/report-lake/schema.ts";
import { listStagingFiles } from "#src/report-lake/staging.ts";
import {
  type StagingGenerationSnapshot,
  STAGING_TABLES,
} from "#src/report-lake/staging/generations.ts";
import { columnsForTable } from "#src/report-lake/fold-parquet.ts";
import type { ReportLakeLayout } from "#src/report-lake/schema-upgrade/layout.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";

const KEYS = {
  raw_documents: ["document_id"],
  matches: ["match_id", "puuid"],
  match_teams: ["match_id", "team_id"],
  match_team_bans: ["match_id", "team_id", "pick_turn"],
  prematch: ["dedupe_key", "puuid"],
  competition_rank_history: ["competition_id", "calculated_at", "player_id"],
  timeline_events: ["event_id"],
  timeline_event_participants: [
    "event_id",
    "participant_id",
    "role",
    "role_index",
  ],
  timeline_participant_frames: ["match_id", "frame_index", "participant_id"],
  timeline_coverage: ["match_id"],
} as const;

async function parquetFiles(dir: string, table: string): Promise<string[]> {
  const files: string[] = [];
  for await (const file of new Bun.Glob(`${table}/**/*.parquet`).scan({
    cwd: dir,
    absolute: true,
  }))
    files.push(file);
  return files.toSorted();
}

/** Validate before publication; the committed tail remains part of the read view. */
export async function validatePreparedBuild(input: {
  lakeDir: string;
  previousDir: string;
  buildDir: string;
  layout: ReportLakeLayout;
  staging: StagingGenerationSnapshot;
  abortSignal: AbortSignal;
  timeoutMs: number;
}): Promise<void> {
  for (const table of STAGING_TABLES) {
    input.abortSignal.throwIfAborted();
    const previous = await parquetFiles(input.previousDir, table);
    const candidate = await parquetFiles(input.buildDir, table);
    const staging = await listStagingFiles(input.lakeDir, table, input.staging);
    const columns = columnsForTable(table, input.layout);
    const keys = KEYS[table];
    const names = keys.join(", ");
    const keyColumns = Object.fromEntries(
      keys.map((key) => {
        const type = columns[key];
        if (type === undefined)
          throw new Error(`Missing ${table}.${key} column contract`);
        return [key, type];
      }),
    );
    await withDuckDBConnection(
      async (session) => {
        if (candidate.length > 0) {
          const described = await session.run(
            "DESCRIBE SELECT * FROM read_parquet(?)",
            [session.list(candidate)],
          );
          const actual = Object.fromEntries(
            described.map((row) => {
              const parsed = z
                .object({ column_name: z.string(), column_type: z.string() })
                .parse(row);
              return [parsed.column_name, parsed.column_type];
            }),
          );
          if (
            Object.keys(actual).length !== Object.keys(columns).length ||
            Object.entries(columns).some(([key, type]) => actual[key] !== type)
          )
            throw new Error(
              `Prepared ${table} physical schema does not match its manifest`,
            );
        }
        if (previous.length === 0) return;
        const sources: string[] = [];
        const params = [session.list(previous)];
        if (candidate.length > 0) {
          sources.push(`SELECT ${names} FROM read_parquet(?)`);
          params.push(session.list(candidate));
        }
        if (staging.length > 0) {
          sources.push(
            `SELECT ${names} FROM read_json(?, format='newline_delimited', columns=${duckDbColumnsSpec(keyColumns)})`,
          );
          params.push(session.list(staging));
        }
        if (sources.length === 0)
          throw new Error(`Prepared lake would lose every ${table} projection`);
        const result = await session.run(
          `SELECT count(*)::DOUBLE AS missing FROM (SELECT ${names} FROM read_parquet(?) EXCEPT (${sources.join(" UNION ALL ")}))`,
          params,
        );
        const missing = z
          .object({ missing: z.number() })
          .parse(result[0]).missing;
        if (missing > 0)
          throw new Error(
            `Prepared lake would lose ${missing.toString()} ${table} projection keys`,
          );
      },
      { abortSignal: input.abortSignal, timeoutMs: input.timeoutMs },
    );
  }
  // Accounts have their own DB refresh, not staging or append semantics.
  const accounts = path.join(input.buildDir, "accounts", "accounts.parquet");
  if (await Bun.file(accounts).exists())
    await withDuckDBConnection(
      async (session) => {
        await session.run("SELECT count(*) FROM read_parquet(?)", [accounts]);
      },
      { abortSignal: input.abortSignal, timeoutMs: input.timeoutMs },
    );
}
