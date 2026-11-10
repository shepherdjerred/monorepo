import { z } from "zod";
import { captureCli } from "#lib/brim/capture/clis.ts";
import {
  bodyBytes,
  type CaptureBody,
  type CaptureHttpRecord,
  type CaptureRecord,
  type CaptureWsCloseRecord,
  type CaptureWsMessageRecord,
  type CaptureWsOpenRecord,
} from "#lib/brim/capture/record.ts";
import {
  chainedContext,
  IdRowSchema,
  insertCapture,
  storeResponse,
  usageJson,
  type CaptureStatus,
} from "./insert.ts";
import { asRecord, parseJsonObject, type JsonRecord } from "./json.ts";
import { parseRequest, responsesRequestBody } from "./request.ts";
import {
  parseHttpResponse,
  responsesResponse,
  type ParsedResponse,
} from "./response.ts";
import type { CaptureStore } from "./store.ts";

/**
 * Applies one spool record to the store. HTTP flows become one capture each.
 * A Codex WebSocket becomes one capture per `response.create`, finished by
 * its terminal server event.
 */

function headerValue(
  headers: readonly (readonly [string, string])[],
  names: readonly string[],
): string | null {
  for (const name of names) {
    const match = headers.find(([key]) => key.toLowerCase() === name);
    if (match !== undefined && match[1].length > 0) return match[1];
  }
  return null;
}

function sessionKeyFor(
  cli: string,
  headers: readonly (readonly [string, string])[],
): string | null {
  return headerValue(headers, captureCli(cli)?.sessionHeaders ?? []);
}

function bodyText(body: CaptureBody | null): string | null {
  return body !== null && "text" in body ? body.text : null;
}

function httpOutcome(
  record: CaptureHttpRecord,
  parsed: ParsedResponse | null,
): { status: CaptureStatus; httpStatus: number | null; error: string | null } {
  const httpStatus = record.response?.status ?? null;
  const httpError =
    httpStatus !== null && httpStatus >= 400
      ? `HTTP ${String(httpStatus)}`
      : null;
  const parsedError =
    parsed?.failed === true ? (parsed.error ?? "The response failed") : null;
  const error =
    record.error ??
    parsedError ??
    httpError ??
    (record.response === null ? "No response" : null);
  return { status: error === null ? "ok" : "error", httpStatus, error };
}

function applyHttp(store: CaptureStore, record: CaptureHttpRecord): boolean {
  const json = parseJsonObject(bodyText(record.request.body));
  const request = json === null ? null : parseRequest(record.host, json);
  const format = request?.format ?? "unknown";
  const responseBody = record.response?.body ?? null;
  const responseText = bodyText(responseBody);
  const parsed =
    format === "unknown" || responseText === null
      ? null
      : parseHttpResponse(
          format,
          responseText,
          headerValue(record.response?.headers ?? [], ["content-type"]),
        );
  const context =
    request === null
      ? { blocks: [], chainedFrom: null, contextComplete: true }
      : chainedContext(store, request);
  const id = insertCapture(store, {
    flowId: record.id,
    seq: 0,
    connectionId: record.connectionId,
    cli: record.cli,
    transport: "http",
    host: record.host,
    path: record.path,
    format,
    sessionKey: sessionKeyFor(record.cli, record.request.headers),
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    ...httpOutcome(record, parsed),
    request,
    ...context,
    // Bodies that did not parse are kept whole, for the raw and field views.
    rawRequestHash:
      format === "unknown" && record.request.body !== null
        ? store.putBlob(bodyBytes(record.request.body))
        : null,
    response: parsed,
    rawResponseHash:
      parsed === null && responseBody !== null
        ? store.putBlob(bodyBytes(responseBody))
        : null,
  });
  return id !== null;
}

const WsFlowRowSchema = z.object({
  flow_id: z.string(),
  connection_id: z.string(),
  cli: z.string(),
  host: z.string(),
  path: z.string(),
  session_key: z.string().nullable(),
});
type WsFlow = z.infer<typeof WsFlowRowSchema>;

function applyWsOpen(store: CaptureStore, record: CaptureWsOpenRecord): void {
  store.run(
    `INSERT OR IGNORE INTO ws_flows (flow_id, connection_id, cli, host, path, session_key, opened_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    record.id,
    record.connectionId,
    record.cli,
    record.host,
    record.path,
    sessionKeyFor(record.cli, record.requestHeaders),
    record.at,
  );
}

function applyWsRequest(
  store: CaptureStore,
  ws: WsFlow,
  record: CaptureWsMessageRecord,
  message: JsonRecord,
): boolean {
  if (message["type"] !== "response.create") return false;
  const request = parseRequest(ws.host, responsesRequestBody(message));
  const id = insertCapture(store, {
    flowId: record.id,
    seq: record.seq,
    connectionId: ws.connection_id,
    cli: ws.cli,
    transport: "websocket",
    host: ws.host,
    path: ws.path,
    format: request.format,
    sessionKey: ws.session_key,
    startedAt: record.at,
    endedAt: null,
    status: "pending",
    httpStatus: null,
    error: null,
    request,
    ...chainedContext(store, request),
    rawRequestHash: null,
    response: null,
    rawResponseHash: null,
  });
  return id !== null;
}

/** `response.created` names the response the oldest pending request gets. */
function applyWsCreated(
  store: CaptureStore,
  record: CaptureWsMessageRecord,
  message: JsonRecord,
): void {
  const responseId = asRecord(message["response"])?.["id"];
  if (typeof responseId !== "string") return;
  if (
    store.get("SELECT id FROM captures WHERE response_id = ?", responseId) !=
    null
  ) {
    return;
  }
  store.run(
    `UPDATE captures SET response_id = ? WHERE id = (
       SELECT id FROM captures WHERE flow_id = ? AND status = 'pending' AND response_id IS NULL
        ORDER BY seq LIMIT 1)`,
    responseId,
    record.id,
  );
}

/** A terminal event finishes the request it answers. */
function applyWsResponse(
  store: CaptureStore,
  record: CaptureWsMessageRecord,
  message: JsonRecord,
): void {
  const response = responsesResponse(message);
  if (response === null) return;
  const byId =
    response.responseId === null
      ? null
      : store.get(
          "SELECT id FROM captures WHERE flow_id = ? AND response_id = ?",
          record.id,
          response.responseId,
        );
  const target =
    byId ??
    store.get(
      "SELECT id FROM captures WHERE flow_id = ? AND status = 'pending' ORDER BY seq LIMIT 1",
      record.id,
    );
  if (target == null) return;
  store.run(
    `UPDATE captures SET status = ?, ended_at = ?, error = ?, usage_json = ?,
       model = COALESCE(?, model), stop_reason = ?, response_id = COALESCE(?, response_id),
       response_hash = ?
     WHERE id = ?`,
    response.failed ? "error" : "ok",
    record.at,
    response.error,
    usageJson(response.usage),
    response.model,
    response.stopReason,
    response.responseId,
    storeResponse(store, response),
    IdRowSchema.parse(target).id,
  );
}

function applyWsMessage(
  store: CaptureStore,
  record: CaptureWsMessageRecord,
): boolean {
  const flow = store.get("SELECT * FROM ws_flows WHERE flow_id = ?", record.id);
  if (flow == null) {
    throw new Error(
      `WebSocket message for flow ${record.id} has no ws-open record.`,
    );
  }
  const ws = WsFlowRowSchema.parse(flow);
  const message = parseJsonObject(bodyText(record.body));
  if (message === null) return false;
  if (record.fromClient) return applyWsRequest(store, ws, record, message);
  if (message["type"] === "response.created") {
    applyWsCreated(store, record, message);
  } else {
    applyWsResponse(store, record, message);
  }
  return false;
}

function applyWsClose(store: CaptureStore, record: CaptureWsCloseRecord): void {
  store.run(
    "UPDATE ws_flows SET closed_at = ? WHERE flow_id = ?",
    record.at,
    record.id,
  );
  store.run(
    `UPDATE captures SET status = 'incomplete', ended_at = ?,
       error = 'The WebSocket closed before the response completed.'
     WHERE flow_id = ? AND status = 'pending'`,
    record.at,
    record.id,
  );
}

/** Applies one record; true when it created a capture. */
export function applyRecord(
  store: CaptureStore,
  record: CaptureRecord,
): boolean {
  switch (record.kind) {
    case "http":
      return applyHttp(store, record);
    case "ws-open":
      applyWsOpen(store, record);
      return false;
    case "ws-message":
      return applyWsMessage(store, record);
    case "ws-close":
      applyWsClose(store, record);
      return false;
  }
}
