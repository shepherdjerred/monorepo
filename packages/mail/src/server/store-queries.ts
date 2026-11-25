import type { Database, SQLQueryBindings } from "bun:sqlite";
import {
  MESSAGE_STATUSES,
  type AdminClientStats,
  type AdminMessageDetail,
  type AdminMessagesResponse,
  type AdminOverviewResponse,
  type MessageStatus,
} from "@shepherdjerred/mail/shared/contract.ts";
import {
  mapMessageDetail,
  mapMessageSummary,
  parseMessageStatus,
  type DeliveryAttemptRow,
  type MessageRow,
} from "./schema.ts";

const MS_PER_DAY = 86_400_000;

export type ListMessagesFilter = {
  readonly status?: MessageStatus | "active" | "all";
  readonly clientId?: string;
  readonly tag?: string;
  readonly q?: string;
  readonly limit?: number;
  readonly offset?: number;
};

export type RelayOverviewMetadata = AdminOverviewResponse["relay"];

function buildWhereClause(filter: ListMessagesFilter): {
  readonly whereSql: string;
  readonly params: SQLQueryBindings[];
} {
  const clauses: string[] = [];
  const params: SQLQueryBindings[] = [];

  if (filter.status === "active") {
    clauses.push("status IN ('queued', 'sending', 'retrying')");
  } else if (filter.status !== undefined && filter.status !== "all") {
    clauses.push("status = ?");
    params.push(filter.status);
  }

  if (filter.clientId !== undefined && filter.clientId.length > 0) {
    clauses.push("client_id = ?");
    params.push(filter.clientId);
  }

  if (filter.tag !== undefined && filter.tag.length > 0) {
    clauses.push("tag = ?");
    params.push(filter.tag);
  }

  if (filter.q !== undefined && filter.q.trim().length > 0) {
    const needle = filter.q.trim().toLowerCase();
    clauses.push(
      "(INSTR(LOWER(subject), ?) > 0 OR INSTR(LOWER(to_header), ?) > 0 OR INSTR(LOWER(from_header), ?) > 0 OR INSTR(LOWER(rfc_message_id), ?) > 0 OR INSTR(LOWER(COALESCE(tag, '')), ?) > 0)",
    );
    params.push(needle, needle, needle, needle, needle);
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return { whereSql, params };
}

export function queryStatusCounts(db: Database): Record<MessageStatus, number> {
  const counts: Record<MessageStatus, number> = {
    queued: 0,
    sending: 0,
    retrying: 0,
    sent: 0,
    failed: 0,
  };
  const rows = db
    .query<{ status: string; c: number }, []>(
      "SELECT status, COUNT(*) AS c FROM messages GROUP BY status",
    )
    .all();
  for (const row of rows) {
    const parsed = parseMessageStatus(row.status);
    if (MESSAGE_STATUSES.includes(parsed)) {
      counts[parsed] = row.c;
    }
  }
  return counts;
}

export function queryMailOverview(
  db: Database,
  relay: RelayOverviewMetadata,
  configuredClientIds: readonly string[],
  nowIso: string,
): AdminOverviewResponse {
  const byStatus = queryStatusCounts(db);
  const since24hIso = new Date(
    new Date(nowIso).getTime() - MS_PER_DAY,
  ).toISOString();

  const recentTotals = db
    .query<{ sent24h: number; failed24h: number }, [string, string]>(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'sent' AND COALESCE(sent_at, updated_at) >= ? THEN 1 ELSE 0 END), 0) AS sent24h,
         COALESCE(SUM(CASE WHEN status = 'failed' AND COALESCE(failed_at, updated_at) >= ? THEN 1 ELSE 0 END), 0) AS failed24h
       FROM messages`,
    )
    .get(since24hIso, since24hIso);

  const clientRows = db
    .query<
      {
        client_id: string;
        sent24h: number;
        failed24h: number;
        active_count: number;
        total_count: number;
      },
      [string, string]
    >(
      `SELECT
         client_id,
         COALESCE(SUM(CASE WHEN status = 'sent' AND COALESCE(sent_at, updated_at) >= ? THEN 1 ELSE 0 END), 0) AS sent24h,
         COALESCE(SUM(CASE WHEN status = 'failed' AND COALESCE(failed_at, updated_at) >= ? THEN 1 ELSE 0 END), 0) AS failed24h,
         COALESCE(SUM(CASE WHEN status IN ('queued', 'sending', 'retrying') THEN 1 ELSE 0 END), 0) AS active_count,
         COUNT(*) AS total_count
       FROM messages
       GROUP BY client_id`,
    )
    .all(since24hIso, since24hIso);

  const clientStatsMap = new Map<string, AdminClientStats>();
  for (const configuredId of configuredClientIds) {
    clientStatsMap.set(configuredId, {
      clientId: configuredId,
      sent24h: 0,
      failed24h: 0,
      activeCount: 0,
      totalCount: 0,
    });
  }
  for (const row of clientRows) {
    clientStatsMap.set(row.client_id, {
      clientId: row.client_id,
      sent24h: row.sent24h,
      failed24h: row.failed24h,
      activeCount: row.active_count,
      totalCount: row.total_count,
    });
  }

  const clients = [...clientStatsMap.values()].sort((a, b) =>
    b.totalCount === a.totalCount
      ? a.clientId.localeCompare(b.clientId)
      : b.totalCount - a.totalCount,
  );

  const active = byStatus.queued + byStatus.sending + byStatus.retrying;
  const all = active + byStatus.sent + byStatus.failed;

  return {
    counts: {
      all,
      queued: byStatus.queued,
      sending: byStatus.sending,
      retrying: byStatus.retrying,
      active,
      sent: byStatus.sent,
      failed: byStatus.failed,
      sent24h: recentTotals?.sent24h ?? 0,
      failed24h: recentTotals?.failed24h ?? 0,
    },
    relay,
    clients,
  };
}

export function queryMessageList(
  db: Database,
  filter: ListMessagesFilter,
): AdminMessagesResponse {
  const limit = Math.min(200, Math.max(1, filter.limit ?? 50));
  const offset = Math.max(0, filter.offset ?? 0);
  const { whereSql, params } = buildWhereClause(filter);

  const countRow = db
    .query<{ total: number }, SQLQueryBindings[]>(
      `SELECT COUNT(*) AS total FROM messages ${whereSql}`,
    )
    .get(...params);

  const rows = db
    .query<MessageRow, SQLQueryBindings[]>(
      `SELECT * FROM messages ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);

  return {
    items: rows.map((row) => mapMessageSummary(row)),
    total: countRow?.total ?? 0,
  };
}

export function queryMessageDetail(
  db: Database,
  id: string,
): AdminMessageDetail | null {
  const row = db
    .query<MessageRow, [string]>("SELECT * FROM messages WHERE id = ?")
    .get(id);
  if (row === null) {
    return null;
  }
  const attempts = db
    .query<DeliveryAttemptRow, [string]>(
      "SELECT * FROM delivery_attempts WHERE message_id = ? ORDER BY attempt_number ASC, id ASC",
    )
    .all(id);
  return mapMessageDetail(row, attempts);
}
