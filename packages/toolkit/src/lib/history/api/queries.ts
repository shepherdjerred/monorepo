import type { Database } from "bun:sqlite";
import { z } from "zod";
import {
  parseHistorySourceName,
  type HistorySourceName,
} from "#lib/history/types.ts";
import type {
  HistoryApiFacetsResponse,
  HistoryApiSession,
  HistoryApiToolsResponse,
  HistoryApiUsage,
  HistoryApiUsageGroup,
  HistoryApiUsageResponse,
} from "./schema.ts";

/** `"local"` selects this machine's own sessions (stored as NULL). */
export const LOCAL_MACHINE = "local";

export type SessionListOptions = {
  readonly since: string | null;
  readonly source: HistorySourceName | null;
  readonly machine: string | null;
  readonly workspace: string | null;
  readonly limit: number;
  readonly offset: number;
};

const SessionRowSchema = z.object({
  id: z.number(),
  source: z.string(),
  source_id: z.string(),
  title: z.string(),
  agent: z.string().nullable(),
  machine: z.string().nullable(),
  workspace: z.string().nullable(),
  git_branch: z.string().nullable(),
  primary_model: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  message_count: z.number(),
  tool_call_count: z.number(),
});

const UsageColumnsSchema = z.object({
  input_tokens: z.number(),
  output_tokens: z.number(),
  cache_read_tokens: z.number(),
  cache_creation_tokens: z.number(),
  cached_input_tokens: z.number(),
  reasoning_tokens: z.number(),
  cost_usd: z.number(),
  cost_complete: z.number(),
});

const DocumentUsageRowSchema = UsageColumnsSchema.extend({
  document_id: z.number(),
  events: z.number(),
});

type DocumentUsage = {
  readonly events: number;
  readonly usage: HistoryApiUsage;
};

const UsageGroupRowSchema = UsageColumnsSchema.extend({
  key: z.string().nullable(),
  session_count: z.number(),
  events: z.number(),
});

const USAGE_SUMS = `
  coalesce(sum(u.input_tokens), 0) AS input_tokens,
  coalesce(sum(u.output_tokens), 0) AS output_tokens,
  coalesce(sum(u.cache_read_tokens), 0) AS cache_read_tokens,
  coalesce(sum(u.cache_creation_tokens), 0) AS cache_creation_tokens,
  coalesce(sum(u.cached_input_tokens), 0) AS cached_input_tokens,
  coalesce(sum(u.reasoning_tokens), 0) AS reasoning_tokens,
  coalesce(sum(u.cost_usd), 0) AS cost_usd,
  coalesce(min(u.cost_complete), 1) AS cost_complete`;

const SESSION_COLUMNS = `d.id, d.source, d.source_id, d.title, d.agent,
  d.machine, d.workspace, d.git_branch, d.primary_model, d.created_at,
  d.updated_at, d.message_count, d.tool_call_count`;

export const EMPTY_API_USAGE: HistoryApiUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  cachedInputTokens: 0,
  reasoningTokens: 0,
  costUsd: 0,
  costComplete: true,
};

function toUsage(row: z.infer<typeof UsageColumnsSchema>): HistoryApiUsage {
  return {
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheCreationTokens: row.cache_creation_tokens,
    cachedInputTokens: row.cached_input_tokens,
    reasoningTokens: row.reasoning_tokens,
    costUsd: row.cost_usd,
    costComplete: row.cost_complete === 1,
  };
}

function addUsage(a: HistoryApiUsage, b: HistoryApiUsage): HistoryApiUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
    costUsd: a.costUsd + b.costUsd,
    costComplete: a.costComplete && b.costComplete,
  };
}

function usageByDocument(
  database: Database,
  ids: readonly number[],
): Map<number, DocumentUsage> {
  const result = new Map<number, DocumentUsage>();
  if (ids.length === 0) {
    return result;
  }
  const placeholders = ids.map(() => "?").join(", ");
  const rows = database
    .prepare(
      `SELECT u.document_id, count(*) AS events, ${USAGE_SUMS}
         FROM usage_events u
        WHERE u.document_id IN (${placeholders})
        GROUP BY u.document_id`,
    )
    .all(...ids)
    .map((row: unknown) => DocumentUsageRowSchema.parse(row));
  for (const row of rows) {
    result.set(row.document_id, { events: row.events, usage: toUsage(row) });
  }
  return result;
}

function hydrate(
  database: Database,
  rows: readonly z.infer<typeof SessionRowSchema>[],
): HistoryApiSession[] {
  const usage = usageByDocument(
    database,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    id: row.id,
    source: parseHistorySourceName(row.source, "in index"),
    sourceId: row.source_id,
    title: row.title,
    agent: row.agent,
    machine: row.machine,
    workspace: row.workspace,
    gitBranch: row.git_branch,
    primaryModel: row.primary_model,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count,
    toolCallCount: row.tool_call_count,
    usageEvents: usage.get(row.id)?.events ?? 0,
    usage: usage.get(row.id)?.usage ?? EMPTY_API_USAGE,
  }));
}

/** The session filters shared by the read API and the CLI index queries. */
export type DocumentFilter = {
  readonly since: string | null;
  readonly source: HistorySourceName | null;
  /** A mirrored machine id, or `LOCAL_MACHINE` for this machine. */
  readonly machine?: string | null;
  readonly workspace?: string | null;
};

/** Appends `WHERE` clauses on `documents d` for each set filter. */
export function addDocumentFilters(
  filter: DocumentFilter,
  clauses: string[],
  values: (string | number)[],
): void {
  if (filter.since !== null) {
    clauses.push("d.updated_at >= ?");
    values.push(filter.since);
  }
  if (filter.source !== null) {
    clauses.push("d.source = ?");
    values.push(filter.source);
  }
  if (filter.machine === LOCAL_MACHINE) {
    clauses.push("d.machine IS NULL");
  } else if (filter.machine != null) {
    clauses.push("d.machine = ?");
    values.push(filter.machine);
  }
  if (filter.workspace != null) {
    clauses.push("d.workspace = ?");
    values.push(filter.workspace);
  }
}

/** A page of sessions, most recently updated first. */
export function querySessions(
  database: Database,
  options: SessionListOptions,
): { sessions: HistoryApiSession[]; hasMore: boolean } {
  const clauses: string[] = [];
  const values: (string | number)[] = [];
  addDocumentFilters(options, clauses, values);
  values.push(options.limit + 1, options.offset);
  const rows = database
    .prepare(
      `SELECT ${SESSION_COLUMNS}
         FROM documents d
        ${clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""}
        ORDER BY d.updated_at DESC, d.id ASC
        LIMIT ? OFFSET ?`,
    )
    .all(...values)
    .map((row: unknown) => SessionRowSchema.parse(row));
  return {
    sessions: hydrate(database, rows.slice(0, options.limit)),
    hasMore: rows.length > options.limit,
  };
}

/** Sessions for the given ids, in the given order; missing ids are skipped. */
export function querySessionsByIds(
  database: Database,
  ids: readonly number[],
): HistoryApiSession[] {
  if (ids.length === 0) {
    return [];
  }
  const placeholders = ids.map(() => "?").join(", ");
  const rows = database
    .prepare(
      `SELECT ${SESSION_COLUMNS} FROM documents d WHERE d.id IN (${placeholders})`,
    )
    .all(...ids)
    .map((row: unknown) => SessionRowSchema.parse(row));
  const byId = new Map(hydrate(database, rows).map((s) => [s.id, s]));
  return ids.flatMap((id) => {
    const session = byId.get(id);
    return session === undefined ? [] : [session];
  });
}

const GROUP_EXPRESSIONS: Record<HistoryApiUsageGroup, string> = {
  day: "date(u.occurred_at, 'localtime')",
  source: "u.source",
  model: "u.model",
  workspace: "d.workspace",
  machine: "d.machine",
};

/**
 * Usage grouped by one dimension, filtered by when each event happened (not
 * a session's last update), matching `toolkit history usage`.
 */
export function queryUsageGroups(
  database: Database,
  options: {
    readonly groupBy: HistoryApiUsageGroup;
    readonly since: string | null;
    readonly source: HistorySourceName | null;
  },
): HistoryApiUsageResponse {
  const clauses: string[] = [];
  const values: string[] = [];
  if (options.since !== null) {
    clauses.push("u.occurred_at >= ?");
    values.push(options.since);
  }
  if (options.source !== null) {
    clauses.push("u.source = ?");
    values.push(options.source);
  }
  const key = GROUP_EXPRESSIONS[options.groupBy];
  const rows = database
    .prepare(
      `SELECT ${key} AS key,
              count(DISTINCT u.document_id) AS session_count,
              count(*) AS events,
              ${USAGE_SUMS}
         FROM usage_events u
         JOIN documents d ON d.id = u.document_id
        ${clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""}
        GROUP BY key
        ORDER BY ${options.groupBy === "day" ? "key ASC" : "cost_usd DESC, key ASC"}`,
    )
    .all(...values)
    .map((row: unknown) => UsageGroupRowSchema.parse(row))
    .map((row) => ({
      key: row.key,
      sessionCount: row.session_count,
      events: row.events,
      ...toUsage(row),
    }));
  const total = rows.reduce<HistoryApiUsage>((sum, row) => {
    const {
      key: _key,
      sessionCount: _sessions,
      events: _events,
      ...usage
    } = row;
    return addUsage(sum, usage);
  }, EMPTY_API_USAGE);
  return {
    apiVersion: 1,
    groupBy: options.groupBy,
    since: options.since,
    total,
    rows,
  };
}

const ToolRowSchema = z.object({
  name: z.string(),
  calls: z.number(),
  sessions: z.number(),
});

/** The most used tools, counting calls and the sessions that made them. */
export function queryTools(
  database: Database,
  options: { readonly since: string | null; readonly limit: number },
): HistoryApiToolsResponse {
  const values: (string | number)[] = [];
  let where = "";
  if (options.since !== null) {
    where = "WHERE coalesce(t.occurred_at, d.updated_at) >= ?";
    values.push(options.since);
  }
  values.push(options.limit);
  const rows = database
    .prepare(
      `SELECT t.name AS name, count(*) AS calls,
              count(DISTINCT t.document_id) AS sessions
         FROM tool_calls t
         JOIN documents d ON d.id = t.document_id
        ${where}
        GROUP BY t.name
        ORDER BY calls DESC, name ASC
        LIMIT ?`,
    )
    .all(...values)
    .map((row: unknown) => ToolRowSchema.parse(row));
  return { apiVersion: 1, since: options.since, rows };
}

const FacetRowSchema = z.object({
  key: z.string().nullable(),
  sessions: z.number(),
});

function facetRows(
  database: Database,
  column: "machine" | "source" | "workspace",
): z.infer<typeof FacetRowSchema>[] {
  return database
    .prepare(
      `SELECT ${column} AS key, count(*) AS sessions
         FROM documents
        GROUP BY ${column}
        ORDER BY sessions DESC, key ASC`,
    )
    .all()
    .map((row: unknown) => FacetRowSchema.parse(row));
}

/**
 * Every machine, source, and workspace with at least one indexed session,
 * counted from documents so sessions without usage still appear.
 */
export function queryFacets(database: Database): HistoryApiFacetsResponse {
  return {
    apiVersion: 1,
    machines: facetRows(database, "machine"),
    sources: facetRows(database, "source").map((row) => ({
      key: parseHistorySourceName(row.key ?? "", "in index"),
      sessions: row.sessions,
    })),
    workspaces: facetRows(database, "workspace"),
  };
}
