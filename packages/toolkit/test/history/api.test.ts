import { afterEach, describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { handleHistoryApiRequest } from "#lib/history/api/handler.ts";
import {
  HISTORY_API_CONTRACTS,
  HistoryApiErrorSchema,
  HistoryApiSessionDetailResponseSchema,
  HistoryApiSessionsResponseSchema,
  HistoryApiToolsResponseSchema,
  HistoryApiUsageResponseSchema,
} from "#lib/history/api/schema.ts";
import { HistoryIndex } from "#lib/history/index.ts";
import { defaultHistoryRuntimePaths } from "#lib/history/paths.ts";
import { documentDetails } from "#lib/history/query/messages.ts";
import { buildCodexThreadDocument } from "#lib/history/sources/codex.ts";
import type {
  HistoryDocument,
  HistoryMessage,
  HistoryRecord,
  HistorySourceName,
  HistorySourceResult,
  UsageEventEntry,
} from "#lib/history/types.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function usageEvent(
  occurredAt: string,
  model: string,
  costUsd: number | null,
): UsageEventEntry {
  return {
    occurredAt,
    model,
    inputTokens: 100,
    outputTokens: 10,
    cacheReadTokens: 1000,
    cacheCreationTokens: 50,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    costUsd,
    costComplete: costUsd !== null,
  };
}

const TRANSCRIPT: readonly HistoryMessage[] = [
  {
    role: "user",
    text: "Prune the stale ArgoCD applications",
    createdAt: "2026-11-08T17:00:00.000Z",
  },
  {
    role: "tool",
    text: "Bash argocd app list",
    createdAt: "2026-11-08T17:00:05.000Z",
    toolName: "Bash",
  },
  {
    role: "tool",
    text: "app-a\napp-b",
    createdAt: "2026-11-08T17:00:06.000Z",
  },
  {
    role: "assistant",
    text: "Two applications are stale.",
    createdAt: "2026-11-08T17:00:09.000Z",
  },
];

function document(
  source: HistorySourceName,
  sourceId: string,
  values: {
    readonly dialogue: string;
    readonly updatedAt: string;
    readonly machine?: string;
    readonly messages?: readonly HistoryMessage[];
    readonly usage?: readonly UsageEventEntry[];
  },
): HistoryDocument {
  return {
    source,
    sourceId,
    title: `Session ${sourceId}`,
    path: `/fixture/${sourceId}`,
    workspace: "/repo",
    agent: "fixture",
    createdAt: values.updatedAt,
    updatedAt: values.updatedAt,
    runtimeId: sourceId,
    openingPromptHash: null,
    dialogueText: values.dialogue,
    toolOutputText: "",
    usageEvents: values.usage ?? [],
    ...documentDetails(values.messages ?? [], "main"),
    machine: values.machine ?? null,
  };
}

function result(
  source: HistorySourceName,
  documents: readonly HistoryDocument[],
): HistorySourceResult {
  return {
    source,
    available: true,
    documents,
    fingerprint: `${source}-v1`,
    error: null,
    complete: true,
    sourceIds: documents.map((entry) => entry.sourceId),
  };
}

async function fixtureIndex(): Promise<HistoryIndex> {
  const root = await mkdtemp(path.join(os.tmpdir(), "toolkit-history-api-"));
  roots.push(root);
  const index = await HistoryIndex.open(defaultHistoryRuntimePaths(root));
  await index.ingest([
    result("claude", [
      document("claude", "argo", {
        dialogue: "prune stale argocd applications",
        updatedAt: "2026-11-08T17:00:09.000Z",
        messages: TRANSCRIPT,
        usage: [
          usageEvent("2026-11-08T17:00:09.000Z", "claude-opus-5-5", 1.5),
          usageEvent("2026-11-08T17:00:30.000Z", "claude-opus-5-5", 0.5),
          usageEvent("2026-11-08T17:01:00.000Z", "claude-haiku-5-5", 0.25),
        ],
      }),
    ]),
    result("codex-mirror", [
      document("codex-mirror", "jerred-desktop/rollout", {
        dialogue: "fix the windows scheduled task",
        updatedAt: "2026-11-07T21:00:00.000Z",
        machine: "jerred-desktop",
        usage: [usageEvent("2026-11-07T21:00:00.000Z", "gpt-5.5", null)],
      }),
    ]),
  ]);
  return index;
}

function readMessages(records: readonly HistoryRecord[]) {
  return Promise.resolve({
    messages: new Map(
      records.map((record) => [
        `${record.source}:${record.sourceId}`,
        TRANSCRIPT,
      ]),
    ),
    warnings: [],
  });
}

async function get(
  index: HistoryIndex,
  pathAndQuery: string,
  method = "GET",
): Promise<{ status: number; body: unknown }> {
  const response = await handleHistoryApiRequest(
    { index, readMessages },
    new Request(`http://history${pathAndQuery}`, { method }),
  );
  if (response === null) {
    throw new Error(`${pathAndQuery} was not routed to the API`);
  }
  return { status: response.status, body: await response.json() };
}

async function fetchBody(
  index: HistoryIndex,
  pathAndQuery: string,
): Promise<unknown> {
  const response = await get(index, pathAndQuery);
  return response.body;
}

async function fetchStatus(
  index: HistoryIndex,
  pathAndQuery: string,
  method: string,
): Promise<number> {
  const response = await get(index, pathAndQuery, method);
  return response.status;
}

describe("history API", () => {
  test("lists sessions newest first with derived details and usage", async () => {
    const index = await fixtureIndex();
    const { status, body } = await get(index, "/v1/sessions?limit=1");
    expect(status).toBe(200);
    const parsed = HistoryApiSessionsResponseSchema.parse(body);
    expect(parsed.hasMore).toBe(true);
    expect(parsed.sessions).toHaveLength(1);
    const [session] = parsed.sessions;
    expect(session).toMatchObject({
      source: "claude",
      machine: null,
      gitBranch: "main",
      primaryModel: "claude-opus-5-5",
      messageCount: 4,
      toolCallCount: 1,
    });
    expect(session?.usage.costUsd).toBeCloseTo(2.25);
    expect(session?.usage.costComplete).toBe(true);
    index.close();
  });

  test("filters by machine, with local meaning this machine", async () => {
    const index = await fixtureIndex();
    const remote = HistoryApiSessionsResponseSchema.parse(
      await fetchBody(index, "/v1/sessions?machine=jerred-desktop"),
    );
    expect(remote.sessions.map((entry) => entry.source)).toEqual([
      "codex-mirror",
    ]);
    expect(remote.sessions[0]?.usage.costComplete).toBe(false);
    const local = HistoryApiSessionsResponseSchema.parse(
      await fetchBody(index, "/v1/sessions?machine=local"),
    );
    expect(local.sessions.map((entry) => entry.source)).toEqual(["claude"]);
    index.close();
  });

  test("searches with BM25 and echoes the query", async () => {
    const index = await fixtureIndex();
    const parsed = HistoryApiSessionsResponseSchema.parse(
      await fetchBody(index, "/v1/search?q=windows%20task"),
    );
    expect(parsed.query).toBe("windows task");
    expect(parsed.sessions.map((entry) => entry.sourceId)).toEqual([
      "jerred-desktop/rollout",
    ]);
    index.close();
  });

  test("returns a page of full messages with tool names", async () => {
    const index = await fixtureIndex();
    const [session] = index.sessions({
      since: null,
      source: "claude",
      machine: null,
      workspace: null,
      limit: 1,
      offset: 0,
    }).sessions;
    const { status, body } = await get(
      index,
      `/v1/sessions/${String(session?.id)}?offset=1&limit=2`,
    );
    expect(status).toBe(200);
    const parsed = HistoryApiSessionDetailResponseSchema.parse(body);
    expect(parsed.totalMessages).toBe(4);
    expect(parsed.offset).toBe(1);
    expect(parsed.messages.map((entry) => entry.toolName)).toEqual([
      "Bash",
      null,
    ]);
    index.close();
  });

  test("groups usage by model and machine", async () => {
    const index = await fixtureIndex();
    const byModel = HistoryApiUsageResponseSchema.parse(
      await fetchBody(index, "/v1/usage?groupBy=model"),
    );
    expect(byModel.rows.map((row) => [row.key, row.events])).toEqual([
      ["claude-opus-5-5", 2],
      ["claude-haiku-5-5", 1],
      ["gpt-5.5", 1],
    ]);
    expect(byModel.total.costUsd).toBeCloseTo(2.25);
    expect(byModel.total.costComplete).toBe(false);
    const byMachine = HistoryApiUsageResponseSchema.parse(
      await fetchBody(index, "/v1/usage?groupBy=machine&since=all"),
    );
    expect(
      byMachine.rows
        .map((row) => row.key ?? "local")
        .toSorted((a, b) => a.localeCompare(b)),
    ).toEqual(["jerred-desktop", "local"]);
    index.close();
  });

  test("counts tool calls per tool", async () => {
    const index = await fixtureIndex();
    const parsed = HistoryApiToolsResponseSchema.parse(
      await fetchBody(index, "/v1/tools"),
    );
    expect(parsed.rows).toEqual([{ name: "Bash", calls: 1, sessions: 1 }]);
    index.close();
  });

  test.each([
    ["/v1/sessions?limit=0", 400],
    ["/v1/sessions?limit=abc", 400],
    ["/v1/sessions?source=nope", 400],
    ["/v1/sessions?since=yesterday", 400],
    ["/v1/search?q=%20", 400],
    ["/v1/usage?groupBy=week", 400],
    ["/v1/sessions/999", 404],
    ["/v1/unknown", 404],
  ])("answers %s with a typed %i", async (pathAndQuery, expected) => {
    const index = await fixtureIndex();
    const { status, body } = await get(index, pathAndQuery);
    expect(status).toBe(expected);
    expect(HistoryApiErrorSchema.parse(body).error.length).toBeGreaterThan(0);
    index.close();
  });

  test("rejects writes and leaves non-API paths to the daemon", async () => {
    const index = await fixtureIndex();
    expect(await fetchStatus(index, "/v1/sessions", "POST")).toBe(405);
    const control = await handleHistoryApiRequest(
      { index, readMessages },
      new Request("http://history/status"),
    );
    expect(control).toBeNull();
    index.close();
  });
});

describe("history API contracts", () => {
  const schemaDir = path.join(import.meta.dirname, "../../schemas");

  test.each(Object.entries(HISTORY_API_CONTRACTS))(
    "%s matches its checked-in JSON Schema and fixture",
    async (name, schema) => {
      const checkedIn: unknown = JSON.parse(
        await readFile(path.join(schemaDir, `${name}.schema.json`), "utf8"),
      );
      expect(z.toJSONSchema(schema)).toEqual(checkedIn);
      const fixture: unknown = JSON.parse(
        await readFile(path.join(schemaDir, `fixtures/${name}.json`), "utf8"),
      );
      expect(() => schema.parse(fixture)).not.toThrow();
    },
  );
});

describe("Codex thread titles", () => {
  test("a subagent thread without a user turn takes its first reply", () => {
    const thread = buildCodexThreadDocument(
      "/fixture/thread_history_1.sqlite",
      { threadId: "01a1-sub", createdAtMs: 0, updatedAtMs: 1000 },
      [
        { role: "tool", text: "rg mirror", createdAt: null, toolName: "exec" },
        {
          role: "assistant",
          text: "Auditing the mirror index",
          createdAt: null,
        },
      ],
      [],
    );
    expect(thread.title).toBe("Auditing the mirror index");
  });
});
