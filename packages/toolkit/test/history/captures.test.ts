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
    // Simulate a capture stored before a pattern existed.
    const leaked = JSON.stringify({
      role: "user",
      content: `token ghp_${"b".repeat(36)}`,
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
