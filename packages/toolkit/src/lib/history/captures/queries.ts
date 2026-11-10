import { z } from "zod";
import { CAPTURE_CLIS } from "#lib/brim/capture/clis.ts";
import type {
  HistoryApiCapture,
  HistoryApiCaptureDetailResponse,
} from "#lib/history/api/schema.ts";
import type { HistorySourceName } from "#lib/history/types.ts";
import { captureBlocks, storedNewKeys } from "./blocks.ts";
import { asRecord, parseJsonOrText, type JsonRecord } from "./json.ts";
import { dumpProtobuf, type ProtoDumpField } from "./protobuf-dump.ts";
import { renderBlock, summarizeResponse } from "./render.ts";
import {
  CAPTURE_FORMATS,
  rebuildRequest,
  type BlockSection,
} from "./request.ts";
import type { CaptureStore } from "./store.ts";

const CaptureRowSchema = z.object({
  id: z.number(),
  cli: z.string(),
  transport: z.enum(["http", "websocket"]),
  format: z.enum(CAPTURE_FORMATS),
  host: z.string(),
  path: z.string(),
  session_key: z.string().nullable(),
  cwd: z.string().nullable(),
  started_at: z.string(),
  ended_at: z.string().nullable(),
  model: z.string().nullable(),
  status: z.enum(["pending", "ok", "error", "incomplete"]),
  http_status: z.number().nullable(),
  error: z.string().nullable(),
  usage_json: z.string().nullable(),
  system_bytes: z.number(),
  tools_bytes: z.number(),
  history_bytes: z.number(),
  new_bytes: z.number(),
  block_count: z.number(),
  new_block_count: z.number(),
  context_complete: z.number(),
  previous_capture_id: z.number().nullable(),
  warmup: z.number(),
  stop_reason: z.string().nullable(),
  envelope_hash: z.string().nullable(),
  response_hash: z.string().nullable(),
  raw_request_hash: z.string().nullable(),
  raw_response_hash: z.string().nullable(),
});
type CaptureRow = z.infer<typeof CaptureRowSchema>;

const UsageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheCreationTokens: z.number(),
  cachedInputTokens: z.number(),
  reasoningTokens: z.number(),
});

function durationMs(row: CaptureRow): number | null {
  return row.ended_at === null
    ? null
    : Math.max(0, Date.parse(row.ended_at) - Date.parse(row.started_at));
}

function toCapture(row: CaptureRow): HistoryApiCapture {
  return {
    id: row.id,
    cli: row.cli,
    transport: row.transport,
    format: row.format,
    host: row.host,
    path: row.path,
    sessionId: row.session_key,
    cwd: row.cwd,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationMs: durationMs(row),
    model: row.model,
    status: row.status,
    httpStatus: row.http_status,
    error: row.error,
    usage:
      row.usage_json === null
        ? null
        : UsageSchema.parse(JSON.parse(row.usage_json)),
    context: {
      systemBytes: row.system_bytes,
      toolsBytes: row.tools_bytes,
      historyBytes: row.history_bytes,
      newBytes: row.new_bytes,
    },
    blockCount: row.block_count,
    newBlockCount: row.new_block_count,
    contextComplete: row.context_complete === 1,
    previousCaptureId: row.previous_capture_id,
    warmup: row.warmup === 1,
  };
}

/** The index document a session filter resolves to. */
export type CaptureSessionTarget = {
  readonly source: HistorySourceName;
  readonly runtimeId: string | null;
  readonly workspace: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

/** Slack around a session's transcript window for the time fallback. */
const FALLBACK_SLACK_MS = 60_000;

function sessionRows(
  store: CaptureStore,
  session: CaptureSessionTarget,
  page: { readonly limit: number; readonly offset: number },
): unknown[] {
  const clis = CAPTURE_CLIS.filter(
    (cli) => cli.historySource === session.source,
  ).map((cli) => cli.name);
  if (clis.length === 0) return [];
  const from = new Date(
    Date.parse(session.createdAt) - FALLBACK_SLACK_MS,
  ).toISOString();
  const to = new Date(
    Date.parse(session.updatedAt) + FALLBACK_SLACK_MS,
  ).toISOString();
  return store.all(
    `SELECT * FROM captures
      WHERE cli IN (${clis.map(() => "?").join(", ")})
        AND (session_key = ?
             OR (session_key IS NULL AND started_at BETWEEN ? AND ?
                 AND (cwd IS NULL OR ? IS NULL OR cwd = ?)))
      ORDER BY started_at ASC, id ASC LIMIT ? OFFSET ?`,
    ...clis,
    session.runtimeId,
    from,
    to,
    session.workspace,
    session.workspace,
    page.limit + 1,
    page.offset,
  );
}

/**
 * Captures for one index document, oldest first: those whose correlation key
 * equals the transcript's runtime id, plus, for captures that carried no key,
 * those from the same CLI inside the session's time window and directory.
 * Without a session, every capture, newest first.
 */
export function listCaptures(
  store: CaptureStore,
  options: {
    readonly session: CaptureSessionTarget | null;
    readonly limit: number;
    readonly offset: number;
  },
): { captures: HistoryApiCapture[]; hasMore: boolean } {
  const rows =
    options.session === null
      ? store.all(
          "SELECT * FROM captures ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?",
          options.limit + 1,
          options.offset,
        )
      : sessionRows(store, options.session, options);
  const captures = rows.map((row) => toCapture(CaptureRowSchema.parse(row)));
  return {
    captures: captures.slice(0, options.limit),
    hasMore: captures.length > options.limit,
  };
}

type Detail = Omit<HistoryApiCaptureDetailResponse, "apiVersion">;
type DetailBlock = Detail["newBlocks"][number];

function detailBlocks(
  store: CaptureStore,
  row: CaptureRow,
): {
  blocks: DetailBlock[];
  sent: { section: BlockSection; value: unknown }[];
} {
  const refs = captureBlocks(store, row.id);
  const newKeys = storedNewKeys(store, row.id);
  const positions = new Map<BlockSection, number>();
  const sent: { section: BlockSection; value: unknown }[] = [];
  const blocks = refs.map((ref): DetailBlock => {
    const index = positions.get(ref.section) ?? 0;
    positions.set(ref.section, index + 1);
    const value = store.blobJson(ref.hash);
    // rawRequest is rebuilt from the sent blocks in order, so a sent block's
    // position among its section's sent blocks is its index there.
    const sentIndex = ref.inherited
      ? null
      : sent.filter((entry) => entry.section === ref.section).length;
    if (!ref.inherited) sent.push({ section: ref.section, value });
    const rendered = renderBlock(row.format, ref.section, value);
    return {
      hash: ref.hash,
      section: ref.section,
      category: ref.category,
      index,
      sentIndex,
      role: rendered.role,
      bytes: ref.bytes,
      inherited: ref.inherited,
      isNew: newKeys.has(`${ref.section}:${String(index)}`),
      parts: [...rendered.parts],
    };
  });
  return { blocks, sent };
}

function rawRequest(
  store: CaptureStore,
  row: CaptureRow,
  sent: readonly { section: BlockSection; value: unknown }[],
): { rawRequest: unknown; fields: ProtoDumpField[] | null } {
  if (row.envelope_hash !== null) {
    const envelope = asRecord(store.blobJson(row.envelope_hash)) ?? {};
    return { rawRequest: rebuildRequest(envelope, sent), fields: null };
  }
  if (row.raw_request_hash === null) return { rawRequest: null, fields: null };
  const bytes = store.blob(row.raw_request_hash);
  const parsed = parseJsonOrText(
    new TextDecoder("utf-8", { fatal: false }).decode(bytes),
  );
  return {
    rawRequest: parsed,
    fields: typeof parsed === "string" ? dumpProtobuf(bytes) : null,
  };
}

function responseValue(
  store: CaptureStore,
  row: CaptureRow,
): JsonRecord | null {
  return row.response_hash === null
    ? null
    : asRecord(store.blobJson(row.response_hash));
}

/** One capture with its rebuilt request, response, and new blocks. */
export function captureDetail(store: CaptureStore, id: number): Detail | null {
  const raw = store.get("SELECT * FROM captures WHERE id = ?", id);
  if (raw == null) return null;
  const row = CaptureRowSchema.parse(raw);
  const { blocks, sent } = detailBlocks(store, row);
  const value = responseValue(store, row);
  const summary =
    value === null
      ? null
      : summarizeResponse(row.format, value, row.stop_reason);
  const rawResponse =
    value ??
    (row.raw_response_hash === null
      ? null
      : parseJsonOrText(store.blobText(row.raw_response_hash)));
  return {
    capture: toCapture(row),
    request: {
      system: blocks.filter((block) => block.section === "system"),
      tools: blocks.filter((block) => block.section === "tools"),
      messages: blocks.filter((block) => block.section === "messages"),
    },
    response:
      summary === null
        ? null
        : {
            ...summary,
            toolCalls: summary.toolCalls.map((call) => ({ ...call })),
          },
    newBlocks: blocks.filter((block) => block.isNew),
    ...rawRequest(store, row, sent),
    rawResponse,
  };
}
