import { stat } from "node:fs/promises";
import path from "node:path";
import type { HistoryPaths } from "#lib/history/paths.ts";
import {
  INDEXED_MESSAGE_PARSE_LIMIT,
  makeHistoryDocument,
  openingPrompt,
  parseConversationEnvelope,
} from "#lib/history/query/messages.ts";
import { parseRecord, stringValue } from "#lib/history/query/text.ts";
import {
  createStagedScanner,
  failedScanResult,
  filesUnder,
  firstText,
  fullScanResult,
  incrementalResult,
  planFileScan,
  sourceReadResult,
  sourceResult,
  type StagedScan,
} from "#lib/history/sources-shared.ts";
import type {
  HistoryDocument,
  HistoryMessage,
  HistoryMessageRole,
  HistoryRecord,
  HistorySource,
  HistorySourceReadResult,
} from "#lib/history/types.ts";
import { parseCodexRolloutUsage } from "./codex-usage.ts";

/**
 * Codex sessions read straight from rollout JSONL, one document per file.
 *
 * The local Codex source takes message text from Codex's own
 * `thread_history_*.sqlite` and only usage from rollouts. Mirrored machines
 * ship rollouts alone, so this reader builds the whole document — messages,
 * workspace, runtime id and usage — from the rollout itself.
 */

const NAME = "codex-mirror";

type Rollout = {
  readonly messages: readonly HistoryMessage[];
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly runtimeId: string | null;
  readonly workspace: string | null;
  readonly gitBranch: string | null;
};

/** Injected context and instructions Codex records as user turns. */
function isInjectedUserText(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("<") || trimmed.startsWith("# AGENTS.md");
}

function contentText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return null;
  const parts = value.flatMap((block: unknown) => {
    const record = parseRecord(block);
    const text = record === null ? null : stringValue(record["text"]);
    return text === null ? [] : [text];
  });
  return parts.length === 0 ? null : parts.join("\n");
}

function itemMessage(
  payload: Record<string, unknown>,
): { role: HistoryMessageRole; text: string; toolName?: string } | null {
  const type = stringValue(payload["type"]);
  switch (type) {
    case "message":
      return conversationMessage(payload);
    case "function_call":
    case "custom_tool_call": {
      const name = stringValue(payload["name"]) ?? "tool";
      const input =
        stringValue(payload["arguments"]) ?? stringValue(payload["input"]);
      return {
        role: "tool",
        text: input === null ? name : `${name} ${input}`,
        toolName: name,
      };
    }
    case "function_call_output":
    case "custom_tool_call_output": {
      const text = contentText(payload["output"]);
      return text === null ? null : { role: "tool", text };
    }
    case null:
    default:
      return null;
  }
}

function conversationMessage(
  payload: Record<string, unknown>,
): { role: HistoryMessageRole; text: string } | null {
  const role = stringValue(payload["role"]);
  const text = contentText(payload["content"]);
  if (text === null) return null;
  const keep =
    role === "assistant" || (role === "user" && !isInjectedUserText(text));
  return keep ? { role: role === "user" ? "user" : "assistant", text } : null;
}

type RolloutState = {
  messages: HistoryMessage[];
  createdAt: string | null;
  updatedAt: string | null;
  runtimeId: string | null;
  workspace: string | null;
  gitBranch: string | null;
};

function applyRecord(
  state: RolloutState,
  record: Record<string, unknown>,
  maxCharacters: number,
): void {
  const payload = parseRecord(record["payload"]);
  if (payload === null) return;
  const timestamp = stringValue(record["timestamp"]);
  if (timestamp !== null) {
    state.createdAt ??= timestamp;
    state.updatedAt = timestamp;
  }
  const type = stringValue(record["type"]);
  if (type === "session_meta") {
    state.runtimeId ??=
      stringValue(payload["id"]) ?? stringValue(payload["session_id"]);
    state.workspace ??= stringValue(payload["cwd"]);
    state.gitBranch ??= stringValue(parseRecord(payload["git"])?.["branch"]);
    return;
  }
  if (type !== "response_item") return;
  const item = itemMessage(payload);
  if (item === null) return;
  const parsed = parseConversationEnvelope(
    item.text,
    item.role,
    timestamp,
    maxCharacters,
  );
  const toolName = item.toolName;
  state.messages.push(
    ...(toolName === undefined
      ? parsed
      : parsed.map((entry) => ({ ...entry, toolName }))),
  );
}

async function readRollout(
  file: string,
  maxCharacters = Number.POSITIVE_INFINITY,
): Promise<Rollout> {
  const raw = await Bun.file(file).text();
  const state: RolloutState = {
    messages: [],
    createdAt: null,
    updatedAt: null,
    runtimeId: null,
    workspace: null,
    gitBranch: null,
  };
  for (const [index, line] of raw.split("\n").entries()) {
    if (line.trim().length === 0) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error: unknown) {
      throw new Error(
        `Malformed Codex rollout line ${String(index + 1)} in ${file}`,
        { cause: error },
      );
    }
    const record = parseRecord(value);
    if (record !== null) applyRecord(state, record, maxCharacters);
  }
  return state;
}

async function parseRolloutDocument(
  file: string,
  sessionsDir: string,
): Promise<HistoryDocument> {
  const rollout = await readRollout(file, INDEXED_MESSAGE_PARSE_LIMIT);
  const usage = await parseCodexRolloutUsage(file);
  const info = await stat(file);
  const fallback = new Date(info.mtimeMs).toISOString();
  return makeHistoryDocument(
    {
      source: NAME,
      sourceId: path.relative(sessionsDir, file),
      title: firstText(
        openingPrompt(rollout.messages) ?? path.basename(file, ".jsonl"),
        "Codex session",
      ),
      path: file,
      workspace: rollout.workspace,
      gitBranch: rollout.gitBranch,
      agent: "Codex",
      createdAt: rollout.createdAt ?? fallback,
      updatedAt: rollout.updatedAt ?? fallback,
      runtimeId: rollout.runtimeId,
      usageEvents: usage.events,
    },
    rollout.messages,
  );
}

async function scanRollouts(
  paths: HistoryPaths,
  previous: ReadonlyMap<string, string> | null,
  force: boolean,
): Promise<StagedScan<ReadonlyMap<string, string>>> {
  const sessionsDir = paths.codexSessionsDir;
  const files = await filesUnder(sessionsDir, ".jsonl");
  if (files.length === 0) {
    return {
      result: await sourceResult(NAME, files, () => []),
      staged: new Map(),
    };
  }
  const plan = await planFileScan(files, previous, force);
  try {
    const documents: HistoryDocument[] = [];
    for (const file of plan.parseFiles) {
      documents.push(await parseRolloutDocument(file, sessionsDir));
    }
    const sourceIds = files.map((file) => path.relative(sessionsDir, file));
    return {
      result: plan.full
        ? fullScanResult(NAME, documents, sourceIds, plan.fingerprint)
        : incrementalResult(NAME, documents, sourceIds, plan.fingerprint),
      staged: plan.signatures,
    };
  } catch (error: unknown) {
    return {
      result: failedScanResult(NAME, plan.fingerprint, error),
      staged: null,
    };
  }
}

async function readRollouts(
  _paths: HistoryPaths,
  records: readonly HistoryRecord[],
): Promise<HistorySourceReadResult> {
  return sourceReadResult(
    NAME,
    records.map((record) => record.sourceId),
    async () => {
      const messages = new Map<string, readonly HistoryMessage[]>();
      for (const record of records) {
        const rollout = await readRollout(record.path);
        messages.set(record.sourceId, rollout.messages);
      }
      return messages;
    },
  );
}

export function createCodexRolloutSource(): HistorySource {
  return {
    name: NAME,
    label: "Codex",
    ...createStagedScanner(scanRollouts),
    read: readRollouts,
  };
}
