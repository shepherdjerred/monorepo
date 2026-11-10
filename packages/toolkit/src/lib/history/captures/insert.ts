import { z } from "zod";
import {
  captureBlocks,
  choosePrevious,
  diffBlocks,
  fromParsed,
  positioned,
  type BlockRef,
} from "./blocks.ts";
import { asRecord } from "./json.ts";
import {
  CAPTURE_FORMATS,
  chainedOutput,
  makeBlock,
  requestCwd,
  type CaptureFormat,
  type ParsedRequest,
} from "./request.ts";
import type { CaptureUsage, ParsedResponse } from "./response.ts";
import type { CaptureStore } from "./store.ts";

/**
 * Writes one capture: its row, its ordered block references, and the diff
 * against the request it continues. A request that continues a response
 * server-side (Codex `previous_response_id`, Claude Code's
 * `thread.continue`) inherits that capture's context plus its response, which
 * rebuilds the full context the model saw.
 */

export type CaptureStatus = "pending" | "ok" | "error" | "incomplete";

export type NewCapture = {
  readonly flowId: string;
  readonly seq: number;
  readonly connectionId: string;
  readonly cli: string;
  readonly transport: "http" | "websocket";
  readonly host: string;
  readonly path: string;
  readonly format: CaptureFormat;
  readonly sessionKey: string | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly status: CaptureStatus;
  readonly httpStatus: number | null;
  readonly error: string | null;
  readonly request: ParsedRequest | null;
  readonly blocks: readonly BlockRef[];
  readonly chainedFrom: number | null;
  readonly contextComplete: boolean;
  readonly rawRequestHash: string | null;
  readonly response: ParsedResponse | null;
  readonly rawResponseHash: string | null;
};

export const IdRowSchema = z.object({ id: z.number() });

export function usageJson(
  usage: CaptureUsage | null | undefined,
): string | null {
  return usage == null ? null : JSON.stringify(usage);
}

export function storeResponse(
  store: CaptureStore,
  response: ParsedResponse | null,
): string | null {
  return response === null
    ? null
    : store.putBlob(JSON.stringify(response.value));
}

const CwdRowSchema = z.object({ cwd: z.string().nullable() });

/** A request states its directory, or inherits it from the one it continues. */
function captureCwd(store: CaptureStore, capture: NewCapture): string | null {
  const stated =
    capture.request === null ? null : requestCwd(capture.request.blocks);
  if (stated !== null || capture.chainedFrom === null) return stated;
  const row = store.get(
    "SELECT cwd FROM captures WHERE id = ?",
    capture.chainedFrom,
  );
  return row == null ? null : CwdRowSchema.parse(row).cwd;
}

function insertRow(store: CaptureStore, capture: NewCapture): number | null {
  const { request, response } = capture;
  const envelope = request?.envelope ?? null;
  const { changes, lastInsertRowid } = store.run(
    `INSERT OR IGNORE INTO captures (
       flow_id, seq, connection_id, cli, transport, host, path, format,
       session_key, cwd, started_at, ended_at, status, http_status, error,
       model, stop_reason, response_id, previous_response_id, context_complete,
       usage_json, envelope_hash, response_hash, raw_request_hash,
       raw_response_hash, warmup)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    capture.flowId,
    capture.seq,
    capture.connectionId,
    capture.cli,
    capture.transport,
    capture.host,
    capture.path,
    capture.format,
    capture.sessionKey,
    captureCwd(store, capture),
    capture.startedAt,
    capture.endedAt,
    capture.status,
    capture.httpStatus,
    capture.error,
    response?.model ?? request?.model ?? null,
    response?.stopReason ?? null,
    response?.responseId ?? null,
    request?.previousResponseId ?? null,
    capture.contextComplete ? 1 : 0,
    usageJson(response?.usage),
    envelope === null ? null : store.putBlob(JSON.stringify(envelope)),
    storeResponse(store, response),
    capture.rawRequestHash,
    capture.rawResponseHash,
    request?.warmup === true ? 1 : 0,
  );
  return changes === 0 ? null : lastInsertRowid;
}

/** Stores each block with whether it was new, so pruning cannot change it. */
function insertBlocks(
  store: CaptureStore,
  id: number,
  blocks: readonly BlockRef[],
  newKeys: ReadonlySet<string>,
): void {
  for (const { block, position, key } of positioned(blocks)) {
    if (block.json !== undefined) store.putBlob(block.json);
    store.run(
      `INSERT INTO capture_blocks (capture_id, section, position, category, hash, identity, bytes, inherited, is_new)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      block.section,
      position,
      block.category,
      block.hash,
      block.identity,
      block.bytes,
      block.inherited ? 1 : 0,
      newKeys.has(key) ? 1 : 0,
    );
  }
}

const WarmupRowSchema = z.object({ warmup: z.number() });

function isWarmup(store: CaptureStore, id: number): boolean {
  return (
    WarmupRowSchema.parse(
      store.get("SELECT warmup FROM captures WHERE id = ?", id),
    ).warmup === 1
  );
}

/** Inserts a capture and its blocks; null when it was already ingested. */
export function insertCapture(
  store: CaptureStore,
  capture: NewCapture,
): number | null {
  const id = insertRow(store, capture);
  if (id === null) return null;
  // A warm-up holds no conversation, so it is never what a request is
  // diffed against, even when the request chains from it.
  const previous =
    choosePrevious(store, { ...capture, id }, capture.blocks) ??
    (capture.chainedFrom !== null && !isWarmup(store, capture.chainedFrom)
      ? capture.chainedFrom
      : null);
  const diff = diffBlocks(
    capture.blocks,
    previous === null ? null : captureBlocks(store, previous),
  );
  insertBlocks(store, id, capture.blocks, diff.newKeys);
  store.run(
    `UPDATE captures SET previous_capture_id = ?, system_bytes = ?, tools_bytes = ?,
       history_bytes = ?, new_bytes = ?, block_count = ?, new_block_count = ?
     WHERE id = ?`,
    previous,
    diff.systemBytes,
    diff.toolsBytes,
    diff.historyBytes,
    diff.newBytes,
    capture.blocks.length,
    diff.newKeys.size,
    id,
  );
  return id;
}

const ChainRowSchema = z.object({
  id: z.number(),
  format: z.enum(CAPTURE_FORMATS),
  context_complete: z.number(),
  response_hash: z.string().nullable(),
});

type ChainedContext = {
  readonly blocks: BlockRef[];
  readonly chainedFrom: number | null;
  readonly contextComplete: boolean;
};

/**
 * The full context a request ran with. A request that continues a response
 * server-side sends only what is new, so its context is the parent's context,
 * then the parent's response, then what it sent. System and tool blocks the
 * parent had and the request did not resend are inherited; every sent block
 * follows them as sent, in order, so the as-sent request keeps a resent block
 * and its `cache_control` even though its identity matches the parent's copy.
 * A parent that was never captured leaves the context incomplete.
 */
export function chainedContext(
  store: CaptureStore,
  request: ParsedRequest,
): ChainedContext {
  const sent = request.blocks.map((block) => fromParsed(block));
  if (request.previousResponseId === null) {
    return { blocks: sent, chainedFrom: null, contextComplete: true };
  }
  const parentRow = store.get(
    "SELECT id, format, context_complete, response_hash FROM captures WHERE response_id = ? ORDER BY id DESC LIMIT 1",
    request.previousResponseId,
  );
  if (parentRow == null) {
    return { blocks: sent, chainedFrom: null, contextComplete: false };
  }
  const parent = ChainRowSchema.parse(parentRow);
  const inherited = captureBlocks(store, parent.id).map((block) => ({
    ...block,
    inherited: true,
  }));
  const response =
    parent.response_hash === null
      ? null
      : asRecord(store.blobJson(parent.response_hash));
  const merged: BlockRef[] = [];
  for (const section of ["system", "tools"] as const) {
    const resent = sent.filter((block) => block.section === section);
    const identities = new Set(resent.map((block) => block.identity));
    merged.push(
      ...inherited.filter(
        (block) => block.section === section && !identities.has(block.identity),
      ),
      ...resent,
    );
  }
  const output =
    response === null ? [] : chainedOutput(parent.format, response);
  merged.push(
    ...inherited.filter((block) => block.section === "messages"),
    ...output.map((item) => fromParsed(makeBlock("messages", item), true)),
    ...sent.filter((block) => block.section === "messages"),
  );
  return {
    blocks: merged,
    chainedFrom: parent.id,
    contextComplete: parent.context_complete === 1,
  };
}
