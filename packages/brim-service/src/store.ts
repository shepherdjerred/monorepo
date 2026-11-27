import { Database } from "bun:sqlite";
import { z } from "zod";
import {
  BillingReadingSchema,
  BillingSnapshotSchema,
  PriorityStateSchema,
  QuotaHistorySampleSchema,
  QuotaReadingSchema,
  QuotaSnapshotSchema,
} from "./contract.ts";
import type {
  MacBookPublication,
  PriorityDelete,
  PriorityImport,
  PriorityPut,
  PriorityState,
  QuotaSnapshot,
} from "./contract.ts";

const COCOA_EPOCH_SECONDS = 978_307_200;
const COLLECTOR_EXPIRY_SECONDS = 15 * 60;
const HISTORY_RETENTION_SECONDS = 30 * 24 * 60 * 60;

export function cocoaSeconds(date: Date): number {
  return date.getTime() / 1000 - COCOA_EPOCH_SECONDS;
}

const jsonRow = z.object({ data: z.string() });
const readingRow = z.object({
  id: z.string(),
  status: z.enum(["current", "sign_in_required", "unavailable", "disabled"]),
  observed_at: z.number(),
  snapshot: z.string().nullable(),
});
const priorityRow = z.object({
  core_id: z.string(),
  terminal_id: z.string(),
  priority: PriorityStateSchema.shape.priority,
  ended: z.union([z.literal(0), z.literal(1)]),
  revision: z.number().int().positive(),
  updated_at: z.iso.datetime(),
  title: z.string().nullable(),
  machine_name: z.string().nullable(),
  origin: z.enum(["macbook", "other", "user"]),
});

function decode<T>(schema: z.ZodType<T>, data: string): T {
  return schema.parse(JSON.parse(data));
}

function priorityState(row: z.infer<typeof priorityRow>): PriorityState {
  return PriorityStateSchema.parse({
    coreId: row.core_id,
    terminalId: row.terminal_id,
    priority: row.priority,
    ended: row.ended === 1,
    revision: row.revision,
    updatedAt: row.updated_at,
    title: row.title ?? undefined,
    machineName: row.machine_name ?? undefined,
  });
}

function statusAt(
  row: z.infer<typeof readingRow>,
  snapshot: { sourceTimestamp: number } | undefined,
  now: number,
) {
  if (row.status === "disabled") return row.status;
  if (row.observed_at + COLLECTOR_EXPIRY_SECONDS <= now) return "not_reporting";
  return snapshot !== undefined &&
    row.status === "current" &&
    snapshot.sourceTimestamp + COLLECTOR_EXPIRY_SECONDS <= now
    ? "unavailable"
    : row.status;
}

export class BrimStore {
  readonly #database: Database;

  constructor(path: string) {
    this.#database = new Database(path, { create: true, strict: true });
    this.#database.run(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS collector (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        collected_at REAL NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS readings (
        kind TEXT NOT NULL CHECK (kind IN ('quota', 'billing')),
        id TEXT NOT NULL,
        status TEXT NOT NULL,
        observed_at REAL NOT NULL,
        snapshot TEXT,
        PRIMARY KEY (kind, id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS quota_history (
        provider TEXT NOT NULL,
        window_id TEXT NOT NULL,
        recorded_at REAL NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (provider, window_id, recorded_at)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS quota_history_at ON quota_history (recorded_at);
      CREATE TABLE IF NOT EXISTS priorities (
        core_id TEXT NOT NULL,
        terminal_id TEXT NOT NULL,
        priority TEXT,
        ended INTEGER NOT NULL CHECK (ended IN (0, 1)),
        revision INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        title TEXT,
        machine_name TEXT,
        origin TEXT NOT NULL,
        PRIMARY KEY (core_id, terminal_id)
      ) STRICT;
    `);
  }

  close(): void {
    this.#database.close();
  }

  #collectedAt(): number | null {
    const row = this.#database
      .query("SELECT collected_at FROM collector WHERE id = 1")
      .get();
    return row === null
      ? null
      : z.object({ collected_at: z.number() }).parse(row).collected_at;
  }

  collector() {
    const collectedAt = this.#collectedAt();
    return {
      device: "macbook" as const,
      collectedAt,
      expiresAt:
        collectedAt === null ? null : collectedAt + COLLECTOR_EXPIRY_SECONDS,
    };
  }

  #saveReadings(publication: MacBookPublication): void {
    const save = this.#database.query(`
      INSERT INTO readings (kind, id, status, observed_at, snapshot)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (kind, id) DO UPDATE SET
        status = excluded.status,
        observed_at = excluded.observed_at,
        snapshot = COALESCE(excluded.snapshot, readings.snapshot)
    `);
    for (const { provider, status, snapshot } of publication.quotas) {
      save.run(
        "quota",
        provider,
        status,
        publication.collectedAt,
        snapshot === undefined ? null : JSON.stringify(snapshot),
      );
    }
    for (const { platform, status, snapshot } of publication.billing) {
      save.run(
        "billing",
        platform,
        status,
        publication.collectedAt,
        snapshot === undefined ? null : JSON.stringify(snapshot),
      );
    }
  }

  publish(publication: MacBookPublication, now: Date): void {
    this.#database
      .transaction(() => {
        const lastPublishedAt = this.#collectedAt();
        if (
          lastPublishedAt === null ||
          publication.collectedAt > lastPublishedAt
        ) {
          this.#saveReadings(publication);
          this.#database
            .query(
              `
          INSERT INTO collector (id, collected_at) VALUES (1, ?)
          ON CONFLICT (id) DO UPDATE SET collected_at = excluded.collected_at
        `,
            )
            .run(publication.collectedAt);
        }

        const cutoff = cocoaSeconds(now) - HISTORY_RETENTION_SECONDS;
        const insert = this.#database.query(`
        INSERT INTO quota_history (provider, window_id, recorded_at, data)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (provider, window_id, recorded_at) DO NOTHING
      `);
        for (const sample of publication.quotaHistory) {
          if (sample.recordedAt >= cutoff) {
            insert.run(
              sample.provider,
              sample.windowID,
              sample.recordedAt,
              JSON.stringify(sample),
            );
          }
        }
        this.#database
          .query("DELETE FROM quota_history WHERE recorded_at < ?")
          .run(cutoff);
      })
      .immediate();
  }

  #readings(kind: "quota" | "billing") {
    return z
      .array(readingRow)
      .parse(
        this.#database
          .query(
            "SELECT id, status, observed_at, snapshot FROM readings WHERE kind = ? ORDER BY id",
          )
          .all(kind),
      );
  }

  quotas(now: Date) {
    return this.#readings("quota").map((row) => {
      const snapshot =
        row.snapshot === null
          ? undefined
          : decode(QuotaSnapshotSchema, row.snapshot);
      return QuotaReadingSchema.parse({
        provider: row.id,
        status: statusAt(row, snapshot, cocoaSeconds(now)),
        snapshot,
      });
    });
  }

  billing(now: Date) {
    return this.#readings("billing").map((row) => {
      const snapshot =
        row.snapshot === null
          ? undefined
          : decode(BillingSnapshotSchema, row.snapshot);
      return BillingReadingSchema.parse({
        platform: row.id,
        status: statusAt(row, snapshot, cocoaSeconds(now)),
        snapshot,
      });
    });
  }

  quotaHistory(now: Date) {
    const cutoff = cocoaSeconds(now) - HISTORY_RETENTION_SECONDS;
    const rows = this.#database
      .query(
        `
      SELECT data FROM quota_history
      WHERE recorded_at >= ?
      ORDER BY recorded_at, provider, window_id
    `,
      )
      .all(cutoff);
    return z
      .array(jsonRow)
      .parse(rows)
      .map(({ data }) => decode(QuotaHistorySampleSchema, data));
  }

  rankingSnapshots(now: Date = new Date()): QuotaSnapshot[] {
    const at = cocoaSeconds(now);
    return this.quotas(now).flatMap(({ status, snapshot }) => {
      if (snapshot === undefined || status === "disabled") return [];
      const stale = (reason: string): QuotaSnapshot => ({
        ...snapshot,
        freshness: { stale: { reason } },
      });
      if (status === "not_reporting") return [stale("MacBook hasn’t reported")];
      if (status === "sign_in_required") return [stale("Sign in on MacBook")];
      if (status === "unavailable") return [stale("Provider unavailable")];

      const windows = snapshot.windows.filter(
        ({ resetAt }) =>
          resetAt === null || resetAt === undefined || resetAt > at,
      );
      return [
        windows.some(
          ({ usedPercent }) =>
            usedPercent !== null && usedPercent !== undefined,
        )
          ? { ...snapshot, windows }
          : stale("No current quota window"),
      ];
    });
  }

  freshSnapshots(now: Date = new Date()): QuotaSnapshot[] {
    return this.rankingSnapshots(now).filter(
      ({ freshness }) => freshness === undefined || "current" in freshness,
    );
  }

  #priorityRow(coreId: string, terminalId: string) {
    const row = this.#database
      .query("SELECT * FROM priorities WHERE core_id = ? AND terminal_id = ?")
      .get(coreId, terminalId);
    return row === null ? null : priorityRow.parse(row);
  }

  priority(coreId: string, terminalId: string): PriorityState {
    const row = this.#priorityRow(coreId, terminalId);
    return row === null
      ? {
          coreId,
          terminalId,
          priority: null,
          ended: false,
          revision: 0,
          updatedAt: null,
        }
      : priorityState(row);
  }

  priorities(): PriorityState[] {
    const rows = this.#database
      .query(
        `
      SELECT * FROM priorities
      WHERE priority IS NOT NULL AND ended = 0
      ORDER BY priority, updated_at DESC, core_id, terminal_id
    `,
      )
      .all();
    return z
      .array(priorityRow)
      .parse(rows)
      .map((row) => priorityState(row));
  }

  #savePriority(
    state: PriorityState,
    origin: z.infer<typeof priorityRow>["origin"],
  ) {
    this.#database
      .query(
        `
      INSERT INTO priorities (core_id, terminal_id, priority, ended, revision, updated_at, title, machine_name, origin)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (core_id, terminal_id) DO UPDATE SET
        priority = excluded.priority,
        ended = excluded.ended,
        revision = excluded.revision,
        updated_at = excluded.updated_at,
        title = excluded.title,
        machine_name = excluded.machine_name,
        origin = excluded.origin
    `,
      )
      .run(
        state.coreId,
        state.terminalId,
        state.priority,
        Number(state.ended),
        state.revision,
        state.updatedAt,
        state.title ?? null,
        state.machineName ?? null,
        origin,
      );
  }

  putPriority(
    coreId: string,
    terminalId: string,
    input: PriorityPut,
    now: Date,
  ) {
    return this.#database
      .transaction(() => {
        const row = this.#priorityRow(coreId, terminalId);
        const existing = this.priority(coreId, terminalId);
        const title = input.title ?? existing.title;
        const machineName = input.machineName ?? existing.machineName;
        if (
          row?.origin === "user" &&
          existing.priority === input.priority &&
          existing.title === title &&
          existing.machineName === machineName
        )
          return { applied: true, state: existing };
        if (
          existing.ended ||
          (input.expectedRevision !== undefined &&
            existing.revision !== input.expectedRevision)
        )
          return { applied: false, state: existing };

        const state = {
          ...existing,
          title,
          machineName,
          priority: input.priority,
          revision: existing.revision + 1,
          updatedAt: now.toISOString(),
        };
        this.#savePriority(state, "user");
        return { applied: true, state };
      })
      .immediate();
  }

  deletePriority(
    coreId: string,
    terminalId: string,
    input: PriorityDelete,
    now: Date,
  ) {
    return this.#database
      .transaction(() => {
        const existing = this.priority(coreId, terminalId);
        const ended = existing.ended || input.ended === true;
        if (
          existing.revision > 0 &&
          existing.priority === null &&
          existing.ended === ended
        ) {
          return { applied: true, state: existing };
        }
        if (
          input.expectedRevision !== undefined &&
          existing.revision !== input.expectedRevision
        ) {
          return { applied: false, state: existing };
        }
        const state = {
          ...existing,
          priority: null,
          ended,
          revision: existing.revision + 1,
          updatedAt: now.toISOString(),
        };
        this.#savePriority(state, "user");
        return { applied: true, state };
      })
      .immediate();
  }

  importPriorities(input: PriorityImport, now: Date): number {
    return this.#database
      .transaction(() => {
        let imported = 0;
        for (const entry of input.priorities) {
          const existing = this.#priorityRow(entry.coreId, entry.terminalId);
          if (
            existing !== null &&
            !(existing.origin === "other" && input.source === "macbook")
          ) {
            continue;
          }
          const state = {
            ...entry,
            ended: false,
            revision: (existing?.revision ?? 0) + 1,
            updatedAt: now.toISOString(),
          };
          this.#savePriority(state, input.source);
          imported++;
        }
        return imported;
      })
      .immediate();
  }
}
