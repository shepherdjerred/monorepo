import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { handleHistoryApiRequest } from "#lib/history/api/handler.ts";
import {
  HistoryApiCaptureDetailResponseSchema,
  HistoryApiCapturesResponseSchema,
  HistoryApiErrorSchema,
} from "#lib/history/api/schema.ts";
import {
  ingestCaptureSpool,
  pruneCaptures,
} from "#lib/history/captures/ingest.ts";
import { listCaptures } from "#lib/history/captures/queries.ts";
import { redactCaptures } from "#lib/history/captures/redact.ts";
import { CaptureStore } from "#lib/history/captures/store.ts";
import { HistoryIndex } from "#lib/history/index.ts";
import { defaultHistoryRuntimePaths } from "#lib/history/paths.ts";
import type { HistoryDocument, HistorySourceName } from "#lib/history/types.ts";
import type { CaptureRecord } from "#lib/brim/capture/record.ts";
import {
  CLAUDE_SESSION,
  CODEX_THREAD,
  WORKSPACE,
  claudeHttp,
  claudeToolTurn,
  CODEX_EXEC_PARAMETERS,
  chatChunk,
  chatHttp,
  codexToolTurn,
  tempDir,
  writeSegment,
} from "#test/support/brim-capture.ts";
import { codexResume } from "#test/support/brim-capture-resume.ts";

const roots: string[] = [];
const opened: { close: () => void }[] = [];

afterEach(async () => {
  for (const handle of opened.splice(0)) handle.close();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

type Fixture = {
  readonly root: string;
  readonly spoolDir: string;
  readonly store: CaptureStore;
  readonly index: HistoryIndex;
};

async function fixture(): Promise<Fixture> {
  const root = await tempDir("toolkit-captures-");
  roots.push(root);
  const runtime = defaultHistoryRuntimePaths(root);
  const store = await CaptureStore.open(runtime.capturesDb);
  const index = await HistoryIndex.open(runtime);
  opened.push(store, index);
  return { root, spoolDir: runtime.captureSpoolDir, store, index };
}

async function ingest(
  context: Fixture,
  records: readonly CaptureRecord[],
  name = "0001-1-000001.jsonl",
) {
  await writeSegment(context.spoolDir, name, records);
  return ingestCaptureSpool({
    store: context.store,
    spoolDir: context.spoolDir,
    retentionDays: 30,
    now: new Date("2026-11-10T04:00:00.000Z"),
  });
}

function document(
  source: HistorySourceName,
  runtimeId: string,
): HistoryDocument {
  return {
    source,
    sourceId: `${source}-${runtimeId}`,
    title: "session",
    path: `/fixture/${runtimeId}`,
    workspace: WORKSPACE,
    agent: null,
    createdAt: "2026-11-10T03:22:00.000Z",
    updatedAt: "2026-11-10T03:35:00.000Z",
    runtimeId,
    openingPromptHash: null,
    dialogueText: "run echo hi",
    toolOutputText: "",
    usageEvents: [],
    toolCalls: [],
    messageCount: 0,
    gitBranch: null,
    machine: null,
  };
}

async function indexSessions(
  context: Fixture,
): Promise<{ claude: number; codex: number }> {
  await context.index.ingest(
    (["claude", "codex"] as const).map((source) => {
      const runtimeId = source === "claude" ? CLAUDE_SESSION : CODEX_THREAD;
      return {
        source,
        available: true,
        documents: [document(source, runtimeId)],
        fingerprint: "v1",
        error: null,
        complete: true,
        sourceIds: [`${source}-${runtimeId}`],
      };
    }),
  );
  const ids = (source: HistorySourceName) =>
    context.index.recent({ since: null, source })[0]?.id ?? Number.NaN;
  return { claude: ids("claude"), codex: ids("codex") };
}

async function get(
  context: Fixture,
  url: string,
): Promise<{ status: number; body: unknown }> {
  const response = await handleHistoryApiRequest(
    {
      index: context.index,
      captures: context.store,
      readMessages: () =>
        Promise.resolve({ messages: new Map(), warnings: [] }),
    },
    new Request(`http://history${url}`),
  );
  if (response === null) throw new Error(`${url} was not routed`);
  return { status: response.status, body: await response.json() };
}

async function fetchJson(context: Fixture, url: string): Promise<unknown> {
  const response = await get(context, url);
  return response.body;
}

async function detail(context: Fixture, id: number) {
  const { status, body } = await get(context, `/v1/captures/${String(id)}`);
  expect(status).toBe(200);
  return HistoryApiCaptureDetailResponseSchema.parse(body);
}

const Count = z.object({ count: z.number() });

/** Every stored blob, decoded, joined. */
function storedBlobs(context: Fixture): string {
  return context.store
    .all("SELECT hash FROM blobs")
    .map((row) =>
      new TextDecoder().decode(
        context.store.blob(z.object({ hash: z.string() }).parse(row).hash),
      ),
    )
    .join("");
}

function requestBody(record: CaptureRecord | undefined): unknown {
  if (
    record?.kind !== "http" ||
    record.request.body === null ||
    !("text" in record.request.body)
  ) {
    throw new Error("fixture record has no text body");
  }
  return JSON.parse(record.request.body.text);
}

describe("capture context reconstruction", () => {
  test("rebuilds a continued Claude thread and diffs it against its parent", async () => {
    const context = await fixture();
    const report = await ingest(context, claudeToolTurn());
    expect(report).toMatchObject({
      segments: 1,
      records: 2,
      captures: 2,
      tornLines: 0,
    });
    expect(await readdir(context.spoolDir)).toEqual([]);
    const sessions = await indexSessions(context);

    const list = HistoryApiCapturesResponseSchema.parse(
      await fetchJson(
        context,
        `/v1/captures?session=${String(sessions.claude)}`,
      ),
    );
    expect(list.session).toBe(sessions.claude);
    const [first, second] = list.captures;
    expect(first).toMatchObject({
      cli: "claude",
      sessionId: CLAUDE_SESSION,
      model: "claude-opus-5-5",
      status: "ok",
      cwd: WORKSPACE,
      durationMs: 1500,
      usage: {
        inputTokens: 2,
        outputTokens: 80,
        cacheReadTokens: 11_607,
        cacheCreationTokens: 22_315,
      },
      previousCaptureId: null,
    });
    expect(second).toMatchObject({
      previousCaptureId: first?.id,
      contextComplete: true,
      cwd: WORKSPACE,
    });

    const parent = await detail(context, first?.id ?? 0);
    expect(parent.response?.toolCalls).toEqual([
      { id: "toolu_1", name: "Bash", arguments: { command: "echo hi" } },
    ]);
    expect(parent.response?.stopReason).toBe("tool_use");
    expect(parent.request.tools.map((block) => block.parts)).toEqual([
      [
        {
          type: "tool_definition",
          name: "Bash",
          namespace: null,
          description: "Run a shell command",
          parameters: { type: "object" },
        },
      ],
      [
        {
          type: "tool_definition",
          name: "Read",
          namespace: null,
          description: "Read a file",
          parameters: { type: "object" },
        },
      ],
    ]);

    const child = await detail(context, second?.id ?? 0);
    expect(child.response?.text).toBe("hi");
    // The parent's system and tools, plus the one new billing header.
    expect(
      child.request.system.map((block) => [
        block.index,
        block.inherited,
        block.sentIndex,
      ]),
    ).toEqual([
      [0, true, null],
      [1, true, null],
      [2, false, 0],
    ]);
    expect(child.request.tools).toHaveLength(2);
    expect(
      child.request.messages.map((block) => [
        block.role,
        block.inherited,
        block.isNew,
      ]),
    ).toEqual([
      ["user", true, false],
      ["assistant", true, true],
      ["user", false, true],
    ]);
    expect(child.newBlocks.map((block) => block.parts[0]?.type)).toEqual([
      "text",
      "tool_call",
      "tool_call_response",
    ]);
    // The raw request is what was sent, not the rebuilt context.
    expect(child.rawRequest).toEqual(requestBody(claudeToolTurn()[1]));
  });

  test("chains Codex WebSocket requests into the full context", async () => {
    const context = await fixture();
    const report = await ingest(context, codexToolTurn());
    expect(report.captures).toBe(3);
    const sessions = await indexSessions(context);
    const list = HistoryApiCapturesResponseSchema.parse(
      await fetchJson(
        context,
        `/v1/captures?session=${String(sessions.codex)}`,
      ),
    );
    expect(list.captures.map((capture) => capture.status)).toEqual([
      "ok",
      "ok",
      "ok",
    ]);
    const [warmup, toolCall, answer] = list.captures;
    expect(list.captures.map((capture) => capture.warmup)).toEqual([
      true,
      false,
      false,
    ]);
    // Chained from the warm-up, but never diffed against it.
    expect(toolCall).toMatchObject({
      previousCaptureId: null,
      newBlockCount: 4,
      contextComplete: true,
    });
    expect(warmup?.blockCount).toBe(0);
    expect(toolCall).toMatchObject({
      transport: "websocket",
      sessionId: CODEX_THREAD,
      cwd: WORKSPACE,
      usage: {
        inputTokens: 26_222,
        cachedInputTokens: 7168,
        reasoningTokens: 3,
      },
    });
    expect(toolCall?.context.toolsBytes).toBeGreaterThan(0);
    expect(toolCall?.context.systemBytes).toBeGreaterThan(0);
    expect(answer).toMatchObject({
      previousCaptureId: toolCall?.id,
      contextComplete: true,
      newBlockCount: 3,
    });

    const full = await detail(context, answer?.id ?? 0);
    expect(
      full.request.messages.map((block) => [block.category, block.inherited]),
    ).toEqual([
      ["tools", true],
      ["system", true],
      ["conversation", true],
      ["conversation", true],
      ["conversation", true],
      ["conversation", true],
      ["conversation", false],
    ]);
    expect(full.request.messages[0]?.parts).toEqual([
      {
        type: "tool_definition",
        name: "exec",
        namespace: "functions",
        description: "Run a command",
        parameters: CODEX_EXEC_PARAMETERS,
      },
      {
        type: "tool_definition",
        name: "apply_patch",
        namespace: "functions",
        description: "Apply a patch",
        parameters: { type: "grammar", syntax: "lark", definition: "start: x" },
      },
      {
        type: "tool_definition",
        name: "sleep",
        namespace: "clock",
        description: "Pause",
        parameters: null,
      },
    ]);
    // `index` is the position in the rebuilt context; `sentIndex` locates
    // the block in rawRequest, which holds only what was sent.
    const sent = full.request.messages.filter((block) => !block.inherited);
    expect(sent.map((block) => [block.index, block.sentIndex])).toEqual([
      [6, 0],
    ]);
    expect(
      full.request.messages
        .filter((block) => block.inherited)
        .map((block) => block.sentIndex),
    ).toEqual([null, null, null, null, null, null]);
    expect(
      full.newBlocks.flatMap((block) => block.parts.map((part) => part.type)),
    ).toEqual(["text", "tool_call", "tool_call_response"]);
    expect(full.rawRequest).toMatchObject({
      previous_response_id: "resp_1",
      input: [
        { type: "function_call_output", call_id: "call_1", output: "hi" },
      ],
    });
  });
});

describe("chained request blocks", () => {
  test("keeps system and tool blocks a chained request resends as sent", async () => {
    const context = await fixture();
    const [first, second] = claudeToolTurn();
    const parentBody = z
      .object({
        system: z.array(z.record(z.string(), z.unknown())),
        tools: z.array(z.unknown()),
      })
      .parse(requestBody(first));
    const childBody = z
      .object({ system: z.array(z.unknown()) })
      .loose()
      .parse(requestBody(second));
    // The main prompt is resent with its cache marker moved, and the tools
    // are resent unchanged.
    const { cache_control: _moved, ...mainPrompt } = parentBody.system[1] ?? {};
    const body = {
      ...childBody,
      system: [...childBody.system, mainPrompt],
      tools: parentBody.tools,
    };
    if (first === undefined || second?.kind !== "http") {
      throw new Error("claudeToolTurn has no chained HTTP request");
    }
    await ingest(context, [
      first,
      {
        ...second,
        request: {
          ...second.request,
          body: { text: JSON.stringify(body) },
        },
      },
    ]);
    const [, child] = HistoryApiCapturesResponseSchema.parse(
      await fetchJson(context, "/v1/captures"),
    ).captures.toReversed();
    const parsed = await detail(context, child?.id ?? 0);
    expect(parsed.rawRequest).toEqual(body);
    expect(
      parsed.request.system.map((block) => [
        block.inherited,
        block.sentIndex,
        block.isNew,
      ]),
    ).toEqual([
      [true, null, false],
      [false, 0, true],
      [false, 1, false],
    ]);
    expect(
      parsed.request.tools.map((block) => [block.inherited, block.isNew]),
    ).toEqual([
      [false, false],
      [false, false],
    ]);
  });
});

describe("Codex warm-ups", () => {
  test("a resumed session diffs against the last real turn, not its warm-up", async () => {
    const context = await fixture();
    await ingest(context, [...codexToolTurn(), ...codexResume()]);
    const sessions = await indexSessions(context);
    const list = HistoryApiCapturesResponseSchema.parse(
      await fetchJson(
        context,
        `/v1/captures?session=${String(sessions.codex)}`,
      ),
    );
    expect(list.captures.map((capture) => capture.warmup)).toEqual([
      true,
      false,
      false,
      true,
      false,
    ]);
    const answer = list.captures[2];
    const resumed = list.captures[4];
    expect(resumed).toMatchObject({
      previousCaptureId: answer?.id,
      newBlockCount: 2,
    });
    const warmupIds = new Set(
      list.captures
        .filter((capture) => capture.warmup)
        .map((capture) => capture.id),
    );
    for (const capture of list.captures) {
      expect(warmupIds.has(capture.previousCaptureId ?? -1)).toBe(false);
    }
    const parsed = await detail(context, resumed?.id ?? 0);
    expect(parsed.newBlocks.map((block) => block.role)).toEqual([
      "assistant",
      "user",
    ]);
  });
});

describe("capture spool handling", () => {
  test("marks a request incomplete when its WebSocket closes first", async () => {
    const context = await fixture();
    await ingest(context, codexToolTurn({ close: true }));
    const list = HistoryApiCapturesResponseSchema.parse(
      await fetchJson(context, "/v1/captures"),
    );
    expect(list.session).toBeNull();
    expect(list.captures[0]).toMatchObject({ status: "incomplete" });
    expect(list.captures[0]?.error).toContain("closed");
  });

  test("stores a block resent on every request once", async () => {
    const context = await fixture();
    await ingest(context, [...claudeToolTurn(), ...codexToolTurn()]);
    const blocks = Count.parse(
      context.store.get("SELECT COUNT(*) AS count FROM capture_blocks"),
    ).count;
    const unique = Count.parse(
      context.store.get(
        "SELECT COUNT(DISTINCT hash) AS count FROM capture_blocks",
      ),
    ).count;
    expect(unique).toBeLessThan(blocks);
  });

  test("redacts credentials before anything is stored", async () => {
    const context = await fixture();
    const key = `sk-ant-api03-${"a".repeat(60)}`;
    const report = await ingest(context, [
      claudeHttp({
        id: "leak",
        at: "2026-11-10T03:23:00.000Z",
        body: {
          model: "m",
          messages: [{ role: "user", content: `my key is ${key}` }],
        },
        response: [],
      }),
    ]);
    expect(report.redactedSecrets).toBe(1);
    const [capture] = HistoryApiCapturesResponseSchema.parse(
      await fetchJson(context, "/v1/captures"),
    ).captures;
    const body = JSON.stringify(await detail(context, capture?.id ?? 0));
    expect(body).not.toContain(key);
    expect(body).toContain("REDACTED-anthropic-key");
  });

  test("redacts a credential that follows a newline, in text and base64 bodies", async () => {
    const context = await fixture();
    // Fabricated, low-entropy stand-in; not a real credential.
    const key = `sk-proj-${"c".repeat(60)}`;
    const leak = claudeHttp({
      id: "leak-newline",
      at: "2026-11-10T03:23:00.000Z",
      body: {
        model: "m",
        messages: [{ role: "user", content: `my key is\n${key}` }],
      },
      response: [],
    });
    const binary = {
      ...claudeHttp({
        id: "leak-binary",
        at: "2026-11-10T03:24:00.000Z",
        body: {},
        response: [],
      }),
      cli: "cursor-agent",
      host: "api2.cursor.sh",
      path: "/aiserver.v1.ChatService/StreamUnifiedChatWithTools",
      request: {
        headers: [],
        body: { base64: Buffer.from(`\u0000\n${key}\n`).toString("base64") },
      },
    } satisfies CaptureRecord;
    const report = await ingest(context, [leak, binary]);
    expect(report.redactedSecrets).toBe(2);
    const { captures } = HistoryApiCapturesResponseSchema.parse(
      await fetchJson(context, "/v1/captures"),
    );
    for (const capture of captures) {
      const body = JSON.stringify(await detail(context, capture.id));
      expect(body).not.toContain(key);
    }
    const stored = storedBlobs(context);
    expect(stored).not.toContain(key);
    expect(stored).toContain("REDACTED-openai-key");
  });

  test("ingests a segment once, drops a torn tail, and fails loudly on a bad record", async () => {
    const context = await fixture();
    const records = claudeToolTurn();
    await writeSegment(
      context.spoolDir,
      "0001-1-000001.jsonl",
      records,
      '{"v":1,"kind":"ht',
    );
    const first = await ingestCaptureSpool({
      store: context.store,
      spoolDir: context.spoolDir,
      retentionDays: 30,
    });
    expect(first).toMatchObject({ captures: 2, tornLines: 1 });
    const again = await ingest(context, records);
    expect(again.captures).toBe(0);

    await writeSegment(context.spoolDir, "0002-1-000001.jsonl", [], "");
    const wrongVersion = JSON.stringify({ ...records[0], v: 2 });
    await writeSegment(
      context.spoolDir,
      "0003-1-000001.jsonl",
      [],
      `${wrongVersion}\n`,
    );
    await expect(
      ingestCaptureSpool({
        store: context.store,
        spoolDir: context.spoolDir,
        retentionDays: 30,
      }),
    ).rejects.toThrow(/0003-1-000001\.jsonl:1 is not a capture record/);
    expect(await readdir(context.spoolDir)).toEqual(["0003-1-000001.jsonl"]);
  });

  test("prunes captures past retention and the blobs only they used", async () => {
    const context = await fixture();
    await ingest(context, claudeToolTurn());
    const blobs = () =>
      Count.parse(context.store.get("SELECT COUNT(*) AS count FROM blobs"))
        .count;
    expect(blobs()).toBeGreaterThan(0);
    expect(
      pruneCaptures(context.store, 30, new Date("2026-11-20T00:00:00.000Z")),
    ).toBe(0);
    expect(
      pruneCaptures(context.store, 1, new Date("2026-11-20T00:00:00.000Z")),
    ).toBe(2);
    expect(blobs()).toBe(0);
  });

  test("keeps a capture's new blocks after the capture it diffed against is pruned", async () => {
    const context = await fixture();
    const [first, second] = claudeToolTurn();
    if (second === undefined || first?.kind !== "http") {
      throw new Error("claudeToolTurn has no HTTP pair");
    }
    await ingest(context, [
      { ...first, startedAt: "2026-11-01T03:23:00.000Z" },
      second,
    ]);
    const [child] = listCaptures(context.store, {
      session: null,
      limit: 1,
      offset: 0,
    }).captures;
    const before = await detail(context, child?.id ?? 0);
    expect(before.capture.previousCaptureId).not.toBeNull();
    expect(before.newBlocks).toHaveLength(before.capture.newBlockCount);

    expect(
      pruneCaptures(context.store, 5, new Date("2026-11-10T04:00:00.000Z")),
    ).toBe(1);
    const after = await detail(context, child?.id ?? 0);
    expect(after.newBlocks).toEqual(before.newBlocks);
    expect(after.request).toEqual(before.request);
    expect(after.capture).toEqual(before.capture);
  });

  test("keeps a WebSocket open past retention and prunes it once closed", async () => {
    const context = await fixture();
    const [open, ...messages] = codexToolTurn();
    if (open === undefined) throw new Error("codexToolTurn has no ws-open");
    await ingest(context, [open, ...messages.slice(0, 3)]);
    const later = new Date("2026-11-20T00:00:00.000Z");
    pruneCaptures(context.store, 1, later);
    const flows = () =>
      Count.parse(context.store.get("SELECT COUNT(*) AS count FROM ws_flows"))
        .count;
    expect(flows()).toBe(1);

    const [, ...closing] = codexToolTurn({ close: true });
    const report = await ingest(
      context,
      closing.slice(3),
      "0002-1-000001.jsonl",
    );
    expect(report.captures).toBe(3);
    pruneCaptures(context.store, 30, later);
    expect(flows()).toBe(1);
    pruneCaptures(context.store, 1, later);
    expect(flows()).toBe(0);
  });
});

describe("capture protocol detection", () => {
  test("parses Anthropic Messages on a non-Anthropic route by its endpoint", async () => {
    const context = await fixture();
    const kimi = {
      ...claudeHttp({
        id: "kimi-1",
        at: "2026-11-10T03:24:00.000Z",
        body: {
          model: "kimi-k3",
          system: "You are Kimi Code.",
          messages: [{ role: "user", content: "say hi" }],
          stream: true,
        },
        response: [
          {
            type: "message_start",
            message: {
              id: "msg_kimi",
              model: "kimi-k3",
              role: "assistant",
              content: [],
              usage: { input_tokens: 12, output_tokens: 1 },
            },
          },
          {
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "" },
          },
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "hi" },
          },
          { type: "content_block_stop", index: 0 },
          {
            type: "message_delta",
            delta: { stop_reason: "end_turn" },
            usage: { output_tokens: 3 },
          },
          { type: "message_stop" },
        ],
        sessionHeader: null,
      }),
      cli: "kimi",
      host: "api.kimi.com",
      path: "/coding/v1/messages",
    } satisfies CaptureRecord;
    const report = await ingest(context, [kimi]);
    expect(report.captures).toBe(1);
    const [capture] = listCaptures(context.store, {
      session: null,
      limit: 1,
      offset: 0,
    }).captures;
    expect(capture).toMatchObject({
      cli: "kimi",
      format: "anthropic-messages",
      model: "kimi-k3",
      usage: { inputTokens: 12, outputTokens: 3 },
    });
    const parsed = await detail(context, capture?.id ?? 0);
    expect(parsed.response).toMatchObject({
      text: "hi",
      stopReason: "end_turn",
    });
    expect(parsed.request.messages.map((block) => block.role)).toEqual([
      "user",
    ]);
  });
});

describe("capture correlation and storage", () => {
  test("falls back to CLI, time window, and directory for a capture without a session key", async () => {
    const context = await fixture();
    const [first] = claudeToolTurn();
    await ingest(context, [
      claudeHttp({
        id: "keyless",
        at: "2026-11-10T03:24:00.000Z",
        body: z.record(z.string(), z.unknown()).parse(requestBody(first)),
        response: [],
        sessionHeader: null,
      }),
    ]);
    const sessions = await indexSessions(context);
    const claude = HistoryApiCapturesResponseSchema.parse(
      await fetchJson(
        context,
        `/v1/captures?session=${String(sessions.claude)}`,
      ),
    );
    expect(claude.captures.map((capture) => capture.sessionId)).toEqual([null]);
    const codex = HistoryApiCapturesResponseSchema.parse(
      await fetchJson(
        context,
        `/v1/captures?session=${String(sessions.codex)}`,
      ),
    );
    expect(codex.captures).toEqual([]);
  });

  test("dumps an unknown binary body as schema-less protobuf fields", async () => {
    const context = await fixture();
    // field 1 = "hi", field 2 = varint 150
    const body = Buffer.from([
      0x0a, 0x02, 0x68, 0x69, 0x10, 0x96, 0x01,
    ]).toString("base64");
    await ingest(context, [
      {
        ...claudeHttp({
          id: "proto",
          at: "2026-11-10T03:23:00.000Z",
          body: {},
          response: [],
        }),
        cli: "cursor-agent",
        host: "api2.cursor.sh",
        path: "/aiserver.v1.ChatService/StreamUnifiedChatWithTools",
        request: { headers: [], body: { base64: body } },
      },
    ]);
    const [capture] = HistoryApiCapturesResponseSchema.parse(
      await fetchJson(context, "/v1/captures"),
    ).captures;
    expect(capture?.format).toBe("unknown");
    const parsed = await detail(context, capture?.id ?? 0);
    expect(parsed.fields).toEqual([
      { path: "1", wire: "string", value: "hi" },
      { path: "2", wire: "varint", value: "150" },
    ]);
  });

  test("redact rewrites a stored blob under its new hash", async () => {
    const context = await fixture();
    await ingest(context, claudeToolTurn());
    const [row] = z
      .array(z.object({ hash: z.string() }))
      .parse(
        context.store.all(
          "SELECT hash FROM capture_blocks WHERE section = 'messages' LIMIT 1",
        ),
      );
    // Simulate a capture stored before a pattern existed; the token follows
    // a newline, which JSON escapes as `\n`.
    const leaked = JSON.stringify({
      role: "user",
      content: `token:\nghp_${"b".repeat(36)}`,
    });
    const leakedHash = context.store.putBlob(leaked);
    context.store.run(
      "UPDATE capture_blocks SET hash = ? WHERE hash = ?",
      leakedHash,
      row?.hash ?? "",
    );
    const dry = await redactCaptures({
      store: context.store,
      spoolDir: context.spoolDir,
      dryRun: true,
    });
    expect(dry).toMatchObject({
      redactedBlobs: 1,
      totals: { "github-token": 1 },
    });
    await redactCaptures({
      store: context.store,
      spoolDir: context.spoolDir,
      dryRun: false,
    });
    const stored = context.store
      .all("SELECT hash FROM capture_blocks")
      .map((entry) => JSON.stringify(entry));
    expect(stored.join("")).not.toContain(leakedHash);
    const again = await redactCaptures({
      store: context.store,
      spoolDir: context.spoolDir,
      dryRun: true,
    });
    expect(again.redactedBlobs).toBe(0);
  });
});

// Assembled at runtime so secret scanners do not flag the fixture.
const PEM_LABEL = ["PRIVATE", "KEY"].join(" ");

/** A Claude request whose one user message is `text`. */
function claudeSays(id: string, at: string, text: string): CaptureRecord {
  return claudeHttp({
    id,
    at,
    body: { model: "m", messages: [{ role: "user", content: text }] },
    response: [],
  });
}

describe("capture redaction boundaries", () => {
  test("never redacts across records, at ingest or in `brim capture redact`", async () => {
    const context = await fixture();
    // PEM armor split over two flows, with another flow's ws-open between
    // them: a match spanning records would swallow the ws-open.
    const [open, ...messages] = codexToolTurn();
    if (open?.kind !== "ws-open") throw new Error("expected a ws-open first");
    const records = [
      claudeSays(
        "pem-begin",
        "2026-11-10T03:23:00.000Z",
        `-----BEGIN ${PEM_LABEL}-----`,
      ),
      open,
      claudeSays(
        "pem-end",
        "2026-11-10T03:24:00.000Z",
        `-----END ${PEM_LABEL}-----`,
      ),
      ...messages,
    ];
    const report = await ingest(context, records);
    expect(report).toMatchObject({
      records: records.length,
      redactedSecrets: 0,
    });
    const { captures } = HistoryApiCapturesResponseSchema.parse(
      await fetchJson(context, "/v1/captures"),
    );
    expect(captures.map((capture) => capture.transport).toSorted()).toEqual([
      "http",
      "http",
      "websocket",
      "websocket",
      "websocket",
    ]);

    // A segment still being written: the same records plus a real match.
    // Fabricated, low-entropy stand-in; not a real credential.
    const key = `ghp_${"b".repeat(36)}`;
    const partial = await writeSegment(
      context.spoolDir,
      "0002-1-000001.jsonl.part",
      [
        ...records,
        claudeSays("key", "2026-11-10T03:25:00.000Z", `token ${key}`),
      ],
    );
    const scanned = await redactCaptures({
      store: null,
      spoolDir: context.spoolDir,
      dryRun: false,
    });
    expect(scanned.totals).toEqual({ "github-token": 1 });
    const text = await Bun.file(partial).text();
    expect(text).not.toContain(key);
    const lines = text
      .trimEnd()
      .split("\n")
      .map((line): unknown => JSON.parse(line));
    expect(lines.slice(0, records.length)).toEqual(records);
  });
});

describe("assembled response redaction", () => {
  test("redacts a key split across streamed deltas before it is stored", async () => {
    const context = await fixture();
    // Fabricated, low-entropy stand-ins; not real credentials.
    const openai = `sk-proj-${"c".repeat(60)}`;
    const github = `ghp_${"d".repeat(36)}`;
    const anthropic = `sk-ant-api03-${"e".repeat(60)}`;
    const chat = chatHttp({
      id: "chat-split",
      at: "2026-11-10T03:23:00.000Z",
      status: 200,
      contentType: "text/event-stream",
      body: [
        chatChunk({ role: "assistant", content: `key ${openai.slice(0, 20)}` }),
        chatChunk({ content: `${openai.slice(20)} done` }),
        chatChunk({
          tool_calls: [
            {
              index: 0,
              id: "call_a",
              function: {
                name: "exec",
                arguments: `{"t":"${github.slice(0, 9)}`,
              },
            },
          ],
        }),
        chatChunk({
          tool_calls: [
            { index: 0, function: { arguments: `${github.slice(9)}"}` } },
          ],
        }),
        chatChunk({}, "tool_calls"),
      ].join(""),
    });
    const claude = claudeHttp({
      id: "claude-split",
      at: "2026-11-10T03:24:00.000Z",
      body: { model: "m", messages: [{ role: "user", content: "hi" }] },
      response: [
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        },
        ...[anthropic.slice(0, 25), anthropic.slice(25)].map((text) => ({
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text },
        })),
      ],
    });
    await ingest(context, [chat, claude]);
    const { captures } = HistoryApiCapturesResponseSchema.parse(
      await fetchJson(context, "/v1/captures"),
    );
    expect(captures).toHaveLength(2);
    const details = await Promise.all(
      captures.map(async (capture) => detail(context, capture.id)),
    );
    const exposed = `${JSON.stringify(details)}${storedBlobs(context)}`;
    for (const key of [openai, github, anthropic]) {
      expect(exposed).not.toContain(key);
    }
    for (const kind of ["openai-key", "github-token", "anthropic-key"]) {
      expect(exposed).toContain(`REDACTED-${kind}`);
    }
  });
});

describe("Chat Completions errors", () => {
  const error = {
    message: "Rate limit reached for gpt-fixture",
    type: "rate_limit_exceeded",
    code: "rate_limit_exceeded",
  };

  test("keeps a JSON error body and fails the capture", async () => {
    const context = await fixture();
    await ingest(context, [
      chatHttp({
        id: "chat-429",
        at: "2026-11-10T03:23:00.000Z",
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ error }),
      }),
    ]);
    const [capture] = HistoryApiCapturesResponseSchema.parse(
      await fetchJson(context, "/v1/captures"),
    ).captures;
    expect(capture).toMatchObject({
      format: "openai-chat",
      status: "error",
      httpStatus: 429,
      error: error.message,
    });
    const parsed = await detail(context, capture?.id ?? 0);
    expect(parsed.rawResponse).toEqual({ error });
  });

  test("fails a 200 stream that ends in an error event", async () => {
    const context = await fixture();
    await ingest(context, [
      chatHttp({
        id: "chat-stream-error",
        at: "2026-11-10T03:23:00.000Z",
        status: 200,
        contentType: "text/event-stream",
        body: `${chatChunk({ role: "assistant", content: "Partial" })}data: ${JSON.stringify({ error })}\n\n`,
      }),
    ]);
    const [capture] = HistoryApiCapturesResponseSchema.parse(
      await fetchJson(context, "/v1/captures"),
    ).captures;
    expect(capture).toMatchObject({
      status: "error",
      httpStatus: 200,
      error: error.message,
    });
    const parsed = await detail(context, capture?.id ?? 0);
    expect(parsed.response?.text).toBe("Partial");
    expect(parsed.rawResponse).toMatchObject({ error });
  });
});

/** A store ingested at v2, then rewound to the v1 shape. */
async function v1Store(records: readonly CaptureRecord[]) {
  const context = await fixture();
  await ingest(context, records);
  const dbPath = context.store.path;
  const novelty = context.store.all(
    "SELECT capture_id, section, position, is_new FROM capture_blocks ORDER BY capture_id, section, position",
  );
  context.store.close();
  opened.splice(opened.indexOf(context.store), 1);
  const database = new Database(dbPath, { strict: true });
  database.run("ALTER TABLE capture_blocks DROP COLUMN is_new");
  database.run("PRAGMA user_version = 1");
  return { dbPath, database, novelty };
}

describe("capture store migration", () => {
  test("recomputes v1 block novelty against each stored predecessor", async () => {
    const { dbPath, database, novelty } = await v1Store(claudeToolTurn());
    database.close();
    const store = await CaptureStore.open(dbPath);
    opened.push(store);
    expect(
      store.all(
        "SELECT capture_id, section, position, is_new FROM capture_blocks ORDER BY capture_id, section, position",
      ),
    ).toEqual(novelty);
    expect(store.get("PRAGMA user_version")).toEqual({ user_version: 2 });
  });

  test("refuses a v1 store whose capture was diffed against a pruned one", async () => {
    const { dbPath, database } = await v1Store(claudeToolTurn());
    database.run(
      "DELETE FROM captures WHERE id = (SELECT MIN(id) FROM captures)",
    );
    database.close();
    await expect(CaptureStore.open(dbPath)).rejects.toThrow(
      /was diffed against capture \d+, which was pruned/,
    );
    const reopened = new Database(dbPath, { strict: true });
    expect(reopened.query("PRAGMA user_version").get()).toEqual({
      user_version: 1,
    });
    reopened.close();
  });
});

describe("captures API", () => {
  test.each([
    ["/v1/captures?session=abc", 400],
    ["/v1/captures?session=0", 400],
    ["/v1/captures?limit=0", 400],
    ["/v1/captures?session=999", 404],
    ["/v1/captures/999", 404],
  ])("answers %s with a typed %i", async (url, expected) => {
    const context = await fixture();
    const { status, body } = await get(context, url);
    expect(status).toBe(expected);
    expect(HistoryApiErrorSchema.parse(body).error.length).toBeGreaterThan(0);
  });

  test("pages captures with hasMore", async () => {
    const context = await fixture();
    await ingest(context, codexToolTurn());
    const page = HistoryApiCapturesResponseSchema.parse(
      await fetchJson(context, "/v1/captures?limit=2"),
    );
    expect(page.captures).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    const rest = HistoryApiCapturesResponseSchema.parse(
      await fetchJson(context, "/v1/captures?limit=2&offset=2"),
    );
    expect(rest.captures).toHaveLength(1);
    expect(rest.hasMore).toBe(false);
  });

  test("keeps the spool path under the brim capture root", () => {
    expect(defaultHistoryRuntimePaths("/Users/me").captureSpoolDir).toBe(
      path.join("/Users/me", ".toolkit/brim-capture/spool"),
    );
  });
});
