import { expect, test, vi } from "vitest";
import { z } from "zod";
import {
  MacBookPublicationSchema,
  type MacBookPublication,
} from "./contract.ts";
import { createBrimApp } from "./server.ts";
import { BrimStore, cocoaSeconds } from "./store.ts";

const TEST_TIME = new Date("2026-11-27T19:00:00Z");
const COLLECTED_AT = cocoaSeconds(TEST_TIME);
const archive = {
  lastSuccessfulSyncAt: "2026-11-27T18:55:00.000Z",
  devices: [
    {
      machineId: "windows",
      displayName: "Windows",
      lastArchivedAt: "2026-11-27T18:52:00.000Z",
      lastIndexedAt: "2026-11-27T18:55:00.000Z",
    },
  ],
};
const tokens = {
  hub: "hub",
  device: "device",
  macbook: "macbook",
  scheduler: "scheduler",
};

test("matches the checked-in MacBook publication contract", async () => {
  const schema = Bun.file(
    new URL("../schemas/macbook-publication-v1.schema.json", import.meta.url),
  );
  expect(z.toJSONSchema(MacBookPublicationSchema)).toEqual(await schema.json());
});

function fixture(onTestFinished: (callback: () => void) => void) {
  const store = new BrimStore(":memory:");
  onTestFinished(() => {
    store.close();
  });
  let now = TEST_TIME;
  const history = vi.fn((request: Request) =>
    Response.json({ url: request.url }),
  );
  const syncArchive = vi.fn(() => Promise.resolve(archive));
  const app = createBrimApp({
    store,
    tokens,
    history,
    syncArchive,
    archiveStatus: () => archive,
    now: () => now,
  });
  return {
    store,
    history,
    syncArchive,
    run: (
      path: string,
      token?: keyof typeof tokens,
      method = "GET",
      body?: unknown,
    ) => {
      const headers = new Headers();
      if (token !== undefined)
        headers.set("Authorization", `Bearer ${tokens[token]}`);
      const url = new URL(path, "http://localhost");
      return app(
        new Request(url.href, {
          method,
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );
    },
    setTime: (seconds: number) => {
      now = new Date(TEST_TIME.getTime() + seconds * 1000);
    },
  };
}

function publication(): MacBookPublication {
  return {
    version: 1,
    collectedAt: COLLECTED_AT,
    quotas: [
      {
        provider: "codex",
        status: "current",
        snapshot: {
          provider: "codex",
          sourceTimestamp: COLLECTED_AT,
          windows: [
            {
              id: "5h",
              label: "5-hour",
              kind: { rolling: { durationSeconds: 18_000 } },
              usedPercent: 99,
              resetAt: COLLECTED_AT + 30,
              sourceTimestamp: COLLECTED_AT,
            },
          ],
        },
      },
    ],
    billing: [
      {
        platform: "openai",
        status: "current",
        snapshot: {
          platform: "openai",
          workspaceNames: ["Workspace"],
          monthlySpend: 1.23,
          projectedSpend: 1.37,
          sourceTimestamp: COLLECTED_AT,
          creditGrants: [],
        },
      },
    ],
    quotaHistory: [
      {
        provider: "codex",
        windowID: "5h",
        label: "5-hour",
        kind: { rolling: { durationSeconds: 18_000 } },
        usedPercent: 99,
        recordedAt: COLLECTED_AT,
      },
    ],
  };
}

test("limits each API surface to its credential and drops auth when delegating", async ({
  onTestFinished,
}) => {
  const { run, history, syncArchive } = fixture(onTestFinished);

  const health = await run("/healthz");
  expect(health.status).toBe(200);
  expect(await health.text()).toBe("ok");
  expect(await run("/")).toHaveProperty("status", 404);
  expect(await run("/v1/overview")).toHaveProperty("status", 401);
  expect(await run("/v1/overview", "device")).toHaveProperty("status", 403);
  expect(await run("/v1/quotas", "device")).toHaveProperty("status", 200);
  expect(
    await run("/v1/publish/macbook", "hub", "PUT", publication()),
  ).toHaveProperty("status", 403);
  expect(
    await run("/v1/priorities/core/t1", "hub", "PUT", { priority: "p0" }),
  ).toHaveProperty("status", 403);
  expect(await run("/v1/history/sessions", "device")).toHaveProperty(
    "status",
    403,
  );
  expect(history).not.toHaveBeenCalled();

  const response = await run("/v1/history/sessions?limit=5", "hub");
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({
    url: "http://localhost/v1/sessions?limit=5",
  });
  expect(history.mock.calls[0]?.[0].headers.get("Authorization")).toBeNull();

  expect(await run("/internal/v1/sync", "macbook", "POST")).toHaveProperty(
    "status",
    403,
  );
  const results = await Promise.all([
    run("/internal/v1/sync", "scheduler", "POST"),
    run("/internal/v1/sync", "scheduler", "POST"),
  ]);
  expect(syncArchive).toHaveBeenCalledTimes(1);
  expect(await results[0].json()).toEqual({ version: 1, archive });
  expect(await results[1].json()).toEqual({ version: 1, archive });
});

test("accepts archive backfill retries without reviving a newer failed reading", async ({
  onTestFinished,
}) => {
  const { run, setTime } = fixture(onTestFinished);
  const input = publication();
  expect(
    await run("/v1/publish/macbook", "macbook", "PUT", input),
  ).toHaveProperty("status", 200);
  setTime(60);
  const failure = {
    ...input,
    collectedAt: COLLECTED_AT + 60,
    quotas: [{ provider: "codex", status: "sign_in_required" }],
    billing: [{ platform: "openai", status: "unavailable" }],
    quotaHistory: [],
  };
  expect(
    await run("/v1/publish/macbook", "macbook", "PUT", failure),
  ).toHaveProperty("status", 200);
  expect(
    await run("/v1/publish/macbook", "macbook", "PUT", input),
  ).toHaveProperty("status", 200);
  const overview = await run("/v1/overview", "hub");
  expect(await overview.json()).toMatchObject({
    collector: { collectedAt: COLLECTED_AT + 60 },
    quotas: [
      {
        provider: "codex",
        status: "sign_in_required",
        snapshot: input.quotas[0]?.snapshot,
      },
    ],
    billing: [
      {
        platform: "openai",
        status: "unavailable",
        snapshot: input.billing[0]?.snapshot,
      },
    ],
    quotaHistory: input.quotaHistory,
    archive,
  });
  const small = await run("/v1/overview?includeQuotaHistory=false", "hub");
  expect(await small.json()).toMatchObject({ quotaHistory: [] });
});

test("separates a resetting window, a stale collector, and expired history", async ({
  onTestFinished,
}) => {
  const { run, store, setTime } = fixture(onTestFinished);
  const input = publication();
  expect(
    await run("/v1/publish/macbook", "macbook", "PUT", input),
  ).toHaveProperty("status", 200);
  expect(store.freshSnapshots(TEST_TIME)).toMatchObject([
    { provider: "codex" },
  ]);

  setTime(30);
  const reset = await run("/v1/quotas", "device");
  expect(await reset.json()).toMatchObject({
    snapshots: [
      { freshness: { stale: { reason: "No current quota window" } } },
    ],
  });
  expect(store.freshSnapshots(new Date(TEST_TIME.getTime() + 30_000))).toEqual(
    [],
  );

  setTime(900);
  const stale = await run("/v1/overview", "hub");
  expect(await stale.json()).toMatchObject({
    quotas: [{ status: "not_reporting" }],
    billing: [{ status: "not_reporting" }],
    quotaHistory: input.quotaHistory,
    archive,
  });

  setTime(31 * 24 * 3600);
  const expiredHistory = await run("/v1/overview", "hub");
  expect(await expiredHistory.json()).toMatchObject({ quotaHistory: [] });
});

test("rejects incompatible, future, and credential-bearing publish payloads", async ({
  onTestFinished,
}) => {
  const { run } = fixture(onTestFinished);
  const input = publication();
  const path = "/v1/publish/macbook";
  expect(
    await run(path, "macbook", "PUT", { ...input, version: 2 }),
  ).toHaveProperty("status", 400);
  expect(
    await run(path, "macbook", "PUT", {
      ...input,
      collectedAt: COLLECTED_AT + 600,
    }),
  ).toHaveProperty("status", 400);
  expect(
    await run(path, "macbook", "PUT", {
      ...input,
      accessToken: "do not accept",
    }),
  ).toHaveProperty("status", 400);

  const empty = await run("/v1/overview", "hub");
  expect(await empty.json()).toMatchObject({
    collector: { collectedAt: null },
    quotas: [],
    billing: [],
  });
});

test("keeps per-terminal revisions, scopes clears, and tombstones ended chats", async ({
  onTestFinished,
}) => {
  const { run } = fixture(onTestFinished);
  const first = "/v1/priorities/core-one/t1";
  const second = "/v1/priorities/core-two/t1";
  const read = await run(first, "device");
  expect(await read.json()).toMatchObject({
    state: { revision: 0, priority: null, ended: false },
  });

  const results = await Promise.all([
    run(first, "device", "PUT", { priority: "p0", expectedRevision: 0 }),
    run(second, "device", "PUT", { priority: "later", expectedRevision: 0 }),
  ]);
  expect(results.map((result) => result.status)).toEqual([200, 200]);
  const repeat = await run(first, "device", "PUT", {
    priority: "p0",
    expectedRevision: 0,
  });
  expect(await repeat.json()).toMatchObject({
    state: { revision: 1, priority: "p0" },
  });

  const conflict = await run(first, "device", "PUT", {
    priority: "p2",
    expectedRevision: 0,
  });
  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toMatchObject({
    state: { revision: 1, priority: "p0" },
  });

  const cleared = await run(first, "device", "DELETE", { expectedRevision: 1 });
  expect(await cleared.json()).toMatchObject({
    state: { revision: 2, priority: null, ended: false },
  });
  const ended = await run(first, "device", "DELETE", {
    expectedRevision: 2,
    ended: true,
  });
  expect(await ended.json()).toMatchObject({
    state: { revision: 3, priority: null, ended: true },
  });
  expect(
    await run(first, "device", "PUT", { priority: "p1", expectedRevision: 3 }),
  ).toHaveProperty("status", 409);
  const list = await run("/v1/priorities", "hub");
  expect(await list.json()).toMatchObject({
    priorities: [{ coreId: "core-two", terminalId: "t1", priority: "later" }],
  });
});

test("gives MacBook precedence for imported marks and preserves subsequent user edits", async ({
  onTestFinished,
}) => {
  const { run } = fixture(onTestFinished);
  const path = "/v1/priorities/import";
  const mark = { coreId: "core", terminalId: "t1", priority: "p2" };
  const other = await run(path, "device", "PUT", {
    source: "other",
    priorities: [mark],
  });
  expect(await other.json()).toEqual({ version: 1, imported: 1 });
  const macbook = await run(path, "device", "PUT", {
    source: "macbook",
    priorities: [{ ...mark, priority: "p0" }],
  });
  expect(await macbook.json()).toEqual({ version: 1, imported: 1 });

  const terminal = "/v1/priorities/core/t1";
  const read = await run(terminal, "device");
  expect(await read.json()).toMatchObject({
    state: { revision: 2, priority: "p0" },
  });
  expect(
    await run(terminal, "device", "DELETE", { expectedRevision: 2 }),
  ).toHaveProperty("status", 200);
  const repeat = await run(path, "device", "PUT", {
    source: "macbook",
    priorities: [mark],
  });
  expect(await repeat.json()).toEqual({ version: 1, imported: 0 });
});
