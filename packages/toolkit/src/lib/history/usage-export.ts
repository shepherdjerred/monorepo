import { Database } from "bun:sqlite";
import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type {
  ExportableUsageEvent,
  UsageDocumentFingerprint,
} from "./usage-query.ts";

/**
 * Durable, monotonic usage totals for the metrics push.
 *
 * The history index is rebuildable by design: ingest deletes a document's
 * usage rows when its transcript disappears, and a schema bump or reindex
 * drops every table. Summing the index would therefore produce counter resets
 * and double counts. This ledger lives in its own database and remembers the
 * stable key of every event it has seen, adding only unseen events to totals
 * that are never decremented.
 *
 * The first refresh records existing events without contributing them, so
 * enabling the push never backfills history. Afterwards only events that
 * occurred at or after that seed time contribute, which also keeps a source
 * that becomes readable later (an unmounted app, a restored backup) from
 * dumping its whole past into the counters at once.
 */

const LEDGER_SCHEMA_VERSION = 1;
const KEY_RETENTION_DAYS = 400;
const DAY_MS = 86_400_000;

export const USAGE_TOKEN_TYPES = [
  "input",
  "output",
  "cache_read",
  "cache_write",
  "cached_input",
  "reasoning",
] as const;

export type UsageTokenType = (typeof USAGE_TOKEN_TYPES)[number];

export type UsageEventReader = {
  usageFingerprints: () => readonly UsageDocumentFingerprint[];
  usageEventsForDocument: (
    documentId: number,
  ) => readonly ExportableUsageEvent[];
};

export type UsageTokenTotal = {
  readonly source: string;
  readonly model: string;
  readonly type: UsageTokenType;
  readonly tokens: number;
};

export type UsageModelTotal = {
  readonly source: string;
  readonly model: string;
  readonly costUsd: number;
  readonly events: number;
};

export type UsageSourceTotal = {
  readonly source: string;
  readonly unpricedEvents: number;
};

export type UsageExportTotals = {
  readonly tokens: readonly UsageTokenTotal[];
  readonly models: readonly UsageModelTotal[];
  readonly sources: readonly UsageSourceTotal[];
};

export type UsageExportRefresh = {
  /** True when this refresh created the seed; nothing contributed. */
  readonly seeded: boolean;
  /** Keys recorded for the first time this refresh. */
  readonly newKeys: number;
  /** New keys that were added to the totals. */
  readonly countedEvents: number;
  /** Keys dropped because their event is older than the retention window. */
  readonly prunedKeys: number;
};

export const EMPTY_USAGE_TOTALS: UsageExportTotals = {
  tokens: [],
  models: [],
  sources: [],
};

function tokenCounts(
  event: ExportableUsageEvent,
): readonly [UsageTokenType, number][] {
  return [
    ["input", event.inputTokens],
    ["output", event.outputTokens],
    ["cache_read", event.cacheReadTokens],
    ["cache_write", event.cacheCreationTokens],
    ["cached_input", event.cachedInputTokens],
    ["reasoning", event.reasoningTokens],
  ];
}

function eventIdentity(event: ExportableUsageEvent): string {
  return JSON.stringify([
    event.source,
    event.sourceId,
    event.occurredAt,
    event.model,
    ...tokenCounts(event).map(([, value]) => value),
  ]);
}

/**
 * Stable keys for one document's events. Two events with identical fields
 * are distinct turns, not duplicates, so each repeat gets the next ordinal.
 */
function keyedUsageEvents(
  events: readonly ExportableUsageEvent[],
): { key: string; event: ExportableUsageEvent }[] {
  const ordinals = new Map<string, number>();
  return events.map((event) => {
    const identity = eventIdentity(event);
    const ordinal = ordinals.get(identity) ?? 0;
    ordinals.set(identity, ordinal + 1);
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(`${identity}#${String(ordinal)}`);
    return { key: hasher.digest("hex"), event };
  });
}

export function usageEventKeys(
  events: readonly ExportableUsageEvent[],
): string[] {
  return keyedUsageEvents(events).map((entry) => entry.key);
}

function occurredAtMs(event: ExportableUsageEvent): number {
  const parsed = Date.parse(event.occurredAt);
  if (Number.isNaN(parsed)) {
    throw new TypeError(
      `Usage event in ${event.source} has an unparseable occurred_at`,
    );
  }
  return parsed;
}

const MetaRowSchema = z.object({ value: z.string() });
const FingerprintRowSchema = z.object({
  source: z.string(),
  source_id: z.string(),
  fingerprint: z.string(),
});
const TokenRowSchema = z.object({
  source: z.string(),
  model: z.string(),
  type: z.enum(USAGE_TOKEN_TYPES),
  tokens: z.number(),
});
const ModelRowSchema = z.object({
  source: z.string(),
  model: z.string(),
  cost_usd: z.number(),
  events: z.number(),
});
const SourceRowSchema = z.object({
  source: z.string(),
  unpriced_events: z.number(),
});

function createSchema(database: Database): void {
  database.run(`
    CREATE TABLE meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE event_keys (
      key TEXT PRIMARY KEY,
      occurred_at_ms INTEGER NOT NULL
    ) WITHOUT ROWID;
    CREATE INDEX event_keys_occurred_at_idx ON event_keys(occurred_at_ms);
    CREATE TABLE document_fingerprints (
      source TEXT NOT NULL,
      source_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      PRIMARY KEY (source, source_id)
    ) WITHOUT ROWID;
    CREATE TABLE token_totals (
      source TEXT NOT NULL,
      model TEXT NOT NULL,
      type TEXT NOT NULL,
      tokens INTEGER NOT NULL,
      PRIMARY KEY (source, model, type)
    ) WITHOUT ROWID;
    CREATE TABLE model_totals (
      source TEXT NOT NULL,
      model TEXT NOT NULL,
      cost_usd REAL NOT NULL,
      events INTEGER NOT NULL,
      PRIMARY KEY (source, model)
    ) WITHOUT ROWID;
    CREATE TABLE source_totals (
      source TEXT PRIMARY KEY,
      unpriced_events INTEGER NOT NULL
    ) WITHOUT ROWID;
    PRAGMA user_version = ${String(LEDGER_SCHEMA_VERSION)};
  `);
}

function schemaVersion(database: Database): number {
  return z
    .object({ user_version: z.number() })
    .parse(database.query("PRAGMA user_version").get()).user_version;
}

type LedgerStatements = {
  readonly insertKey: ReturnType<Database["prepare"]>;
  readonly addTokens: ReturnType<Database["prepare"]>;
  readonly addModel: ReturnType<Database["prepare"]>;
  readonly addUnpriced: ReturnType<Database["prepare"]>;
  readonly upsertFingerprint: ReturnType<Database["prepare"]>;
  readonly deleteFingerprint: ReturnType<Database["prepare"]>;
};

function prepareStatements(database: Database): LedgerStatements {
  return {
    insertKey: database.prepare(
      "INSERT OR IGNORE INTO event_keys (key, occurred_at_ms) VALUES (?, ?)",
    ),
    addTokens: database.prepare(`
      INSERT INTO token_totals (source, model, type, tokens) VALUES (?, ?, ?, ?)
      ON CONFLICT(source, model, type) DO UPDATE SET tokens = tokens + excluded.tokens
    `),
    addModel: database.prepare(`
      INSERT INTO model_totals (source, model, cost_usd, events) VALUES (?, ?, ?, 1)
      ON CONFLICT(source, model) DO UPDATE SET
        cost_usd = cost_usd + excluded.cost_usd,
        events = events + 1
    `),
    addUnpriced: database.prepare(`
      INSERT INTO source_totals (source, unpriced_events) VALUES (?, ?)
      ON CONFLICT(source) DO UPDATE SET
        unpriced_events = unpriced_events + excluded.unpriced_events
    `),
    upsertFingerprint: database.prepare(`
      INSERT INTO document_fingerprints (source, source_id, fingerprint) VALUES (?, ?, ?)
      ON CONFLICT(source, source_id) DO UPDATE SET fingerprint = excluded.fingerprint
    `),
    deleteFingerprint: database.prepare(
      "DELETE FROM document_fingerprints WHERE source = ? AND source_id = ?",
    ),
  };
}

type CountingWindow = {
  /** Events before this contribute nothing; `null` while seeding. */
  readonly seedMs: number | null;
  /** Events before this are outside retention and ignored entirely. */
  readonly horizonMs: number;
};

function documentKey(source: string, sourceId: string): string {
  return JSON.stringify([source, sourceId]);
}

export class UsageExportLedger {
  readonly #database: Database;
  readonly #path: string;

  private constructor(database: Database, ledgerPath: string) {
    this.#database = database;
    this.#path = ledgerPath;
  }

  static async open(ledgerPath: string): Promise<UsageExportLedger> {
    await mkdir(path.dirname(ledgerPath), { recursive: true, mode: 0o700 });
    const database = new Database(ledgerPath, { create: true, strict: true });
    try {
      await chmod(ledgerPath, 0o600);
      const version = schemaVersion(database);
      if (version === 0) {
        createSchema(database);
      } else if (version !== LEDGER_SCHEMA_VERSION) {
        throw new Error(
          `Usage export ledger ${ledgerPath} is schema v${String(version)}, expected v${String(LEDGER_SCHEMA_VERSION)}.`,
        );
      }
      database.run("PRAGMA busy_timeout = 5000;");
    } catch (error) {
      database.close();
      throw error;
    }
    return new UsageExportLedger(database, ledgerPath);
  }

  get path(): string {
    return this.#path;
  }

  close(): void {
    this.#database.close();
  }

  /** When the ledger was seeded, or `null` before the first refresh. */
  seededAt(): Date | null {
    const row = this.#database
      .prepare("SELECT value FROM meta WHERE key = 'seeded_at'")
      .get();
    return row == null ? null : new Date(MetaRowSchema.parse(row).value);
  }

  /**
   * Record every event the index currently holds and add unseen ones to the
   * totals. Runs in one transaction, so a crash mid-refresh leaves the ledger
   * exactly as the previous refresh did.
   */
  refresh(reader: UsageEventReader, now: Date): UsageExportRefresh {
    return this.#database.transaction(() => this.#refresh(reader, now))();
  }

  #refresh(reader: UsageEventReader, now: Date): UsageExportRefresh {
    const existingSeed = this.seededAt();
    const seeded = existingSeed === null;
    const seedMs = existingSeed?.getTime() ?? now.getTime();
    if (seeded) {
      this.#database
        .prepare("INSERT INTO meta (key, value) VALUES ('seeded_at', ?)")
        .run(now.toISOString());
    }
    const horizonMs = now.getTime() - KEY_RETENTION_DAYS * DAY_MS;
    const statements = prepareStatements(this.#database);
    const known = new Map(
      this.#database
        .prepare(
          "SELECT source, source_id, fingerprint FROM document_fingerprints",
        )
        .all()
        .map((row: unknown) => FingerprintRowSchema.parse(row))
        .map((row) => [documentKey(row.source, row.source_id), row]),
    );

    let newKeys = 0;
    let countedEvents = 0;
    const present = new Set<string>();
    const window: CountingWindow = {
      seedMs: seeded ? null : seedMs,
      horizonMs,
    };
    for (const document of reader.usageFingerprints()) {
      const key = documentKey(document.source, document.sourceId);
      present.add(key);
      if (known.get(key)?.fingerprint === document.fingerprint) {
        continue;
      }
      const recorded = this.#recordEvents(
        statements,
        reader.usageEventsForDocument(document.documentId),
        window,
      );
      newKeys += recorded.newKeys;
      countedEvents += recorded.countedEvents;
      statements.upsertFingerprint.run(
        document.source,
        document.sourceId,
        document.fingerprint,
      );
    }
    for (const [key, row] of known) {
      if (!present.has(key)) {
        statements.deleteFingerprint.run(row.source, row.source_id);
      }
    }
    const pruned = this.#database
      .prepare("DELETE FROM event_keys WHERE occurred_at_ms < ?")
      .run(horizonMs);
    return { seeded, newKeys, countedEvents, prunedKeys: pruned.changes };
  }

  /**
   * Record one document's event keys. A key contributes only the first time
   * it is seen, after the seed, and inside the retention window.
   */
  #recordEvents(
    statements: LedgerStatements,
    events: readonly ExportableUsageEvent[],
    window: CountingWindow,
  ): { newKeys: number; countedEvents: number } {
    let newKeys = 0;
    let countedEvents = 0;
    for (const { key, event } of keyedUsageEvents(events)) {
      const eventMs = occurredAtMs(event);
      if (eventMs < window.horizonMs) {
        continue;
      }
      const inserted = statements.insertKey.run(key, eventMs);
      if (inserted.changes === 0) {
        continue;
      }
      newKeys += 1;
      if (window.seedMs !== null && eventMs >= window.seedMs) {
        this.#contribute(statements, event);
        countedEvents += 1;
      }
    }
    return { newKeys, countedEvents };
  }

  #contribute(statements: LedgerStatements, event: ExportableUsageEvent): void {
    for (const [type, tokens] of tokenCounts(event)) {
      if (tokens > 0) {
        statements.addTokens.run(event.source, event.model, type, tokens);
      }
    }
    statements.addModel.run(event.source, event.model, event.costUsd ?? 0);
    statements.addUnpriced.run(event.source, event.costComplete ? 0 : 1);
  }

  totals(): UsageExportTotals {
    const tokens = this.#database
      .prepare(
        "SELECT source, model, type, tokens FROM token_totals ORDER BY source, model, type",
      )
      .all()
      .map((row: unknown) => TokenRowSchema.parse(row));
    const models = this.#database
      .prepare(
        "SELECT source, model, cost_usd, events FROM model_totals ORDER BY source, model",
      )
      .all()
      .map((row: unknown) => ModelRowSchema.parse(row));
    const sources = this.#database
      .prepare(
        "SELECT source, unpriced_events FROM source_totals ORDER BY source",
      )
      .all()
      .map((row: unknown) => SourceRowSchema.parse(row));
    return {
      tokens,
      models: models.map((row) => ({
        source: row.source,
        model: row.model,
        costUsd: row.cost_usd,
        events: row.events,
      })),
      sources: sources.map((row) => ({
        source: row.source,
        unpricedEvents: row.unpriced_events,
      })),
    };
  }
}
