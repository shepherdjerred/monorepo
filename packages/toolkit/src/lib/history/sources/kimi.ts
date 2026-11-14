import path from "node:path";
import { z } from "zod";
import {
  INDEXED_MESSAGE_PARSE_LIMIT,
  makeHistoryDocument,
  openingPrompt,
  parseConversationEnvelope,
} from "#lib/history/query/messages.ts";
import type { HistoryPaths } from "#lib/history/paths.ts";
import { parseRecord, stringValue } from "#lib/history/query/text.ts";
import {
  createStagedScanner,
  failedScanResult,
  filesUnder,
  firstText,
  fullScanResult,
  incrementalResult,
  pathExists,
  planFileScan,
  sourceReadResult,
  sourceResult,
  type StagedScan,
} from "#lib/history/sources-shared.ts";
import type {
  HistoryDocument,
  HistoryMessage,
  HistoryRecord,
  HistorySource,
  UsageEventEntry,
} from "#lib/history/types.ts";
import {
  catalogCost,
  optionalUsageNumber,
  requiredUsageNumber,
  usageEventEntry,
  type UsageCounts,
  type UsageFieldLocation,
} from "#lib/history/usage-cost.ts";
import { epochTimestamp, jsonLines, modifiedAt } from "./jsonl.ts";

/**
 * Kimi Code (`~/.kimi-code/sessions`). Each session directory
 * `wd_<slug>_<hash>/session_<uuid>/` holds a `state.json` (title, cwd,
 * timestamps, and its agents) and one `agents/<agentId>/wire.jsonl` event log
 * per agent: `main`, plus one per subagent. Every wire log is indexed as its
 * own document, the way Claude Code subagent transcripts are; a subagent's
 * title names the session it belongs to.
 *
 * Kimi records no git branch, so `gitBranch` stays null.
 */

const SOURCE = "Kimi";
const MAIN_AGENT = "main";
const WIRE_FILE = "wire.jsonl";
const STATE_FILE = "state.json";

const KimiStateSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  cwd: z.string().min(1),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
  agents: z.record(z.string(), z.object({ type: z.string().min(1) })),
});

type KimiState = z.infer<typeof KimiStateSchema>;

type KimiWire = {
  readonly messages: readonly HistoryMessage[];
  readonly usageEvents: readonly UsageEventEntry[];
  readonly firstAt: string | null;
  readonly lastAt: string | null;
};

/**
 * Candidate catalog ids for a logged Kimi model. Kimi Code logs its model as
 * `kimi-code/<id>` (`kimi-code/k3.1-pro`), which is the model the Kimi API
 * publishes as `kimi-<id>` (`kimi-k3.1-pro`,
 * https://platform.kimi.ai/docs/pricing/chat) and the shared catalog prices
 * under that id. Kimi Code itself is subscription-billed, so the result is a
 * list-price estimate, like Claude Code's. The logged id is tried first.
 */
export function kimiModelCandidates(model: string): readonly string[] {
  const bare = model.replace(/^kimi-code\//u, "");
  const api = bare.startsWith("kimi-") ? bare : `kimi-${bare}`;
  return [...new Set([model, api])];
}

/**
 * `usage.record` is the one usage source: Kimi repeats the same per-step
 * counts on `context.append_loop_event` `step.end` events and on assistant
 * `agent.message.appended` `meta.usage`, so reading those too would count
 * every model call two or three times. Only `usageScope: "turn"` records are
 * per-call; other scopes are cumulative session totals and are skipped.
 *
 * Kimi follows the Anthropic convention: `inputOther` is the uncached input,
 * and `inputCacheRead`/`inputCacheCreation` are additive on top of it.
 */
function kimiUsageEvent(
  record: Record<string, unknown>,
  location: UsageFieldLocation,
): UsageEventEntry | null {
  const scope = stringValue(record["usageScope"]);
  if (scope === null) {
    throw new Error(
      `Kimi usage record missing its usageScope on line ${String(location.lineNumber)} in ${location.filePath}`,
    );
  }
  if (scope !== "turn") {
    return null;
  }
  const usage = parseRecord(record["usage"]);
  const model = stringValue(record["model"]);
  if (usage === null || model === null) {
    throw new Error(
      `Malformed Kimi usage record on line ${String(location.lineNumber)} in ${location.filePath}`,
    );
  }
  const counts: UsageCounts = {
    inputTokens: requiredUsageNumber(SOURCE, usage, "inputOther", location),
    outputTokens: requiredUsageNumber(SOURCE, usage, "output", location),
    cacheReadTokens: optionalUsageNumber(
      SOURCE,
      usage,
      "inputCacheRead",
      location,
    ),
    cacheCreationTokens: optionalUsageNumber(
      SOURCE,
      usage,
      "inputCacheCreation",
      location,
    ),
    cachedInputTokens: 0,
    reasoningTokens: 0,
  };
  return usageEventEntry(
    epochTimestamp(record["time"], 1, {
      source: SOURCE,
      label: "usage record",
      location,
    }),
    model,
    counts,
    catalogCost(kimiModelCandidates(model), counts),
  );
}

function textParts(value: unknown): unknown[] {
  return (Array.isArray(value) ? value : []).filter(
    (part) => stringValue(parseRecord(part)?.["type"]) === "text",
  );
}

/**
 * A tool result's `output` is either a string or content parts; image parts
 * carry no indexed text. Any other shape is a contract change.
 */
function toolResultContent(
  result: Record<string, unknown> | null,
  location: UsageFieldLocation,
): unknown {
  const output = result?.["output"];
  if (typeof output === "string") {
    return output;
  }
  if (Array.isArray(output)) {
    return textParts(output);
  }
  throw new Error(
    `Malformed Kimi tool result on line ${String(location.lineNumber)} in ${location.filePath}`,
  );
}

/**
 * Dialogue comes from these records only:
 * - `turn.prompt` (and `turn.steer` typed by the user mid-turn) are user
 *   messages. Steers injected by skill activation are instructions, not
 *   dialogue.
 * - `agent.message.appended` with role `assistant` is the reply; its `think`
 *   parts are reasoning and are not indexed. Its `toolCalls` repeat the
 *   loop's `tool.call` events, which are the one tool-call source.
 * - `context.append_loop_event` `tool.call`/`tool.result` are the tool
 *   invocation (name and arguments) and its output.
 * The many other record types (`context.append_message` echoes, step and
 * permission bookkeeping, tool snapshots) repeat or describe these.
 */
function kimiMessages(
  record: Record<string, unknown>,
  createdAt: string | null,
  location: UsageFieldLocation,
  maxCharacters: number,
): HistoryMessage[] {
  switch (stringValue(record["type"]) ?? "") {
    case "turn.prompt": {
      return parseConversationEnvelope(
        { role: "user", content: textParts(record["input"]) },
        "user",
        createdAt,
        maxCharacters,
      );
    }
    case "turn.steer": {
      const origin = parseRecord(record["origin"]);
      return stringValue(origin?.["kind"]) === "user"
        ? parseConversationEnvelope(
            { role: "user", content: textParts(record["input"]) },
            "user",
            createdAt,
            maxCharacters,
          )
        : [];
    }
    case "agent.message.appended": {
      const message = parseRecord(parseRecord(record["message"])?.["message"]);
      return stringValue(message?.["role"]) === "assistant"
        ? parseConversationEnvelope(
            { role: "assistant", content: textParts(message?.["content"]) },
            "assistant",
            createdAt,
            maxCharacters,
          )
        : [];
    }
    case "context.append_loop_event": {
      return kimiLoopEventMessages(record, createdAt, location, maxCharacters);
    }
    default: {
      return [];
    }
  }
}

function kimiLoopEventMessages(
  record: Record<string, unknown>,
  createdAt: string | null,
  location: UsageFieldLocation,
  maxCharacters: number,
): HistoryMessage[] {
  const event = parseRecord(record["event"]);
  switch (stringValue(event?.["type"]) ?? "") {
    case "tool.call": {
      const name = stringValue(event?.["name"]);
      if (name === null) {
        throw new Error(
          `Kimi tool call missing its name on line ${String(location.lineNumber)} in ${location.filePath}`,
        );
      }
      return parseConversationEnvelope(
        {
          role: "assistant",
          content: [{ type: "tool_use", name, input: event?.["args"] ?? {} }],
        },
        "assistant",
        createdAt,
        maxCharacters,
      );
    }
    case "tool.result": {
      return parseConversationEnvelope(
        {
          role: "tool",
          content: toolResultContent(parseRecord(event?.["result"]), location),
        },
        "tool",
        createdAt,
        maxCharacters,
      );
    }
    default: {
      return [];
    }
  }
}

async function readKimiWire(
  filePath: string,
  maxCharacters = Number.POSITIVE_INFINITY,
): Promise<KimiWire> {
  const messages: HistoryMessage[] = [];
  const usageEvents: UsageEventEntry[] = [];
  let firstAt: string | null = null;
  let lastAt: string | null = null;
  for await (const { record, location } of jsonLines(SOURCE, filePath)) {
    if (record === null) {
      continue;
    }
    const createdAt =
      record["time"] === undefined
        ? null
        : epochTimestamp(record["time"], 1, {
            source: SOURCE,
            label: "record",
            location,
          });
    if (createdAt !== null) {
      firstAt ??= createdAt;
      lastAt = createdAt;
    }
    if (stringValue(record["type"]) === "usage.record") {
      const event = kimiUsageEvent(record, location);
      if (event !== null) {
        usageEvents.push(event);
      }
      continue;
    }
    messages.push(...kimiMessages(record, createdAt, location, maxCharacters));
  }
  return { messages, usageEvents, firstAt, lastAt };
}

async function readKimiState(statePath: string): Promise<KimiState> {
  if (!(await pathExists(statePath))) {
    throw new Error(`Kimi session is missing its state.json: ${statePath}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(await Bun.file(statePath).text()) as unknown;
  } catch (error) {
    throw new Error(`Kimi session state is malformed: ${statePath}`, {
      cause: error,
    });
  }
  const parsed = KimiStateSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Kimi session state is malformed: ${statePath}`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

type WirePath = {
  readonly file: string;
  readonly sessionDir: string;
  readonly agentId: string;
};

const WIRE_PATH =
  /^(?<workdir>[^/]+)\/(?<session>[^/]+)\/agents\/(?<agent>[^/]+)\/wire\.jsonl$/u;

/** Only `<wd>/<session>/agents/<agentId>/wire.jsonl` is an agent log. */
function wirePath(sessionsDir: string, file: string): WirePath | null {
  const relative = path.relative(sessionsDir, file).split(path.sep).join("/");
  const groups = WIRE_PATH.exec(relative)?.groups;
  const workdir = groups?.["workdir"];
  const session = groups?.["session"];
  const agentId = groups?.["agent"];
  return workdir === undefined || session === undefined || agentId === undefined
    ? null
    : { file, sessionDir: path.join(sessionsDir, workdir, session), agentId };
}

async function kimiWires(sessionsDir: string): Promise<WirePath[]> {
  const files = await filesUnder(sessionsDir, WIRE_FILE);
  return files.flatMap((file) => {
    const wire = wirePath(sessionsDir, file);
    return wire === null ? [] : [wire];
  });
}

async function kimiDocument(
  wire: WirePath,
  sessionsDir: string,
): Promise<HistoryDocument> {
  const state = await readKimiState(path.join(wire.sessionDir, STATE_FILE));
  const parsed = await readKimiWire(wire.file, INDEXED_MESSAGE_PARSE_LIMIT);
  const baseTitle = firstText(
    state.title.length > 0
      ? state.title
      : (openingPrompt(parsed.messages) ?? state.id),
    "Kimi Code session",
  );
  const isMain = wire.agentId === MAIN_AGENT;
  const agentType = state.agents[wire.agentId]?.type ?? wire.agentId;
  const fallback = await modifiedAt(wire.file);
  return makeHistoryDocument(
    {
      source: "kimi",
      sourceId: path.relative(sessionsDir, wire.file),
      title: isMain
        ? baseTitle
        : firstText(`[${agentType} subagent] ${baseTitle}`, baseTitle),
      path: wire.file,
      workspace: state.cwd,
      gitBranch: null,
      agent: "Kimi Code",
      // state.json timestamps (epoch ms) describe the session as a whole.
      createdAt: isMain
        ? new Date(state.createdAt).toISOString()
        : (parsed.firstAt ?? fallback),
      updatedAt: isMain
        ? new Date(state.updatedAt).toISOString()
        : (parsed.lastAt ?? fallback),
      runtimeId: state.id,
      usageEvents: parsed.usageEvents,
    },
    parsed.messages,
  );
}

async function scanKimi(
  paths: HistoryPaths,
  previous: ReadonlyMap<string, string> | null,
  force: boolean,
): Promise<StagedScan<ReadonlyMap<string, string>>> {
  const wires = await kimiWires(paths.kimiSessionsDir);
  if (wires.length === 0) {
    return {
      result: await sourceResult("kimi", [], () => []),
      staged: new Map(),
    };
  }
  const states = [
    ...new Set(wires.map((wire) => path.join(wire.sessionDir, STATE_FILE))),
  ];
  const existingStates: string[] = [];
  for (const state of states) {
    if (await pathExists(state)) {
      existingStates.push(state);
    }
  }
  const plan = await planFileScan(
    [...wires.map((wire) => wire.file), ...existingStates],
    previous,
    force,
  );
  // A changed state.json (a retitle, say) re-parses every wire log of its session.
  const changed = new Set(plan.parseFiles);
  const parseWires = wires.filter(
    (wire) =>
      plan.full ||
      changed.has(wire.file) ||
      changed.has(path.join(wire.sessionDir, STATE_FILE)),
  );
  try {
    const documents: HistoryDocument[] = [];
    for (const wire of parseWires) {
      documents.push(await kimiDocument(wire, paths.kimiSessionsDir));
    }
    const sourceIds = wires.map((wire) =>
      path.relative(paths.kimiSessionsDir, wire.file),
    );
    return {
      result: plan.full
        ? fullScanResult("kimi", documents, sourceIds, plan.fingerprint)
        : incrementalResult("kimi", documents, sourceIds, plan.fingerprint),
      staged: plan.signatures,
    };
  } catch (error: unknown) {
    return {
      result: failedScanResult("kimi", plan.fingerprint, error),
      staged: null,
    };
  }
}

export function createKimiSource(): HistorySource {
  return {
    name: "kimi",
    label: "Kimi Code",
    ...createStagedScanner(scanKimi),
    async read(_paths: HistoryPaths, records: readonly HistoryRecord[]) {
      return sourceReadResult(
        "kimi",
        records.map((record) => record.sourceId),
        async () => {
          const messages = new Map<string, readonly HistoryMessage[]>();
          for (const record of records) {
            const parsed = await readKimiWire(record.path);
            messages.set(record.sourceId, parsed.messages);
          }
          return messages;
        },
      );
    },
  };
}
