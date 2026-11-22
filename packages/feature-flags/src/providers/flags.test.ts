import { afterEach, describe, expect, test, vi } from "vitest";
import { ErrorCode } from "@openfeature/server-sdk";
import type { FlagValue } from "@shepherdjerred/feature-flags/evaluate.ts";
import {
  FlagsProvider,
  type FlagsFetcher,
  type FlagsHttpResponse,
} from "@shepherdjerred/feature-flags/providers/flags.ts";

const CONTEXT = { targetingKey: "entity-1" };

const DEFAULT_FLAGS = [
  { type: "boolean", key: "plain-on", default: true, rollouts: [] },
  { type: "boolean", key: "plain-off", default: false, rollouts: [] },
  {
    type: "boolean",
    key: "ranked-rollouts",
    default: false,
    rollouts: [
      {
        constraints: [{ property: "user", value: "blocked-user" }],
        result: false,
      },
      {
        constraints: [{ property: "server", value: "guild-1" }],
        result: true,
      },
    ],
  },
  {
    type: "boolean",
    key: "multi-constraint",
    default: false,
    rollouts: [
      {
        constraints: [
          { property: "stage", value: "beta" },
          { property: "attempt", value: "2" },
          { property: "canary", value: "true" },
        ],
        result: true,
      },
    ],
  },
  {
    type: "boolean",
    key: "object-guard",
    default: false,
    rollouts: [
      {
        constraints: [{ property: "nested", value: "[object Object]" }],
        result: true,
      },
    ],
  },
  { type: "variant", key: "model-name", value: "gpt-6-luna" },
  { type: "variant", key: "token-budget", value: "0.33" },
  { type: "variant", key: "zero-budget", value: "0" },
  { type: "variant", key: "non-numeric", value: "soon" },
  { type: "variant", key: "empty-variant", value: "" },
  { type: "variant", key: "whitespace-variant", value: "   " },
  { type: "variant", key: "infinite-variant", value: "Infinity" },
] as const satisfies readonly FlagValue[];

type RecordedCall = {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
};

type FakeFlagsBehavior =
  | {
      readonly kind: "snapshot";
      readonly body: unknown;
      readonly etag?: string;
    }
  | { readonly kind: "not-modified"; readonly etag?: string }
  | { readonly kind: "http-error"; readonly status: number }
  | { readonly kind: "network-error"; readonly message: string }
  | { readonly kind: "invalid-json" };

function buildResponse(
  status: number,
  body: unknown,
  etag?: string,
  jsonImpl?: () => Promise<unknown>,
): FlagsHttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 304 ? "Not Modified" : status === 200 ? "OK" : "Err",
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "etag" ? (etag ?? null) : null,
    },
    json: jsonImpl ?? (() => Promise.resolve(body)),
  };
}

const DEFAULT_SERVER_BEHAVIOR: FakeFlagsBehavior = {
  kind: "snapshot",
  body: {
    deployment: "scout/prod",
    revision: 1,
    flags: DEFAULT_FLAGS,
  },
  etag: '"1"',
};

function createFakeFlagsServer(
  initial: FakeFlagsBehavior = DEFAULT_SERVER_BEHAVIOR,
) {
  let behavior = initial;
  const calls: RecordedCall[] = [];
  const fetcher: FlagsFetcher = (url, init) => {
    calls.push({ url, headers: { ...init.headers } });
    switch (behavior.kind) {
      case "snapshot":
        return Promise.resolve(
          buildResponse(200, behavior.body, behavior.etag),
        );
      case "not-modified":
        return Promise.resolve(buildResponse(304, null, behavior.etag));
      case "http-error":
        return Promise.resolve(
          buildResponse(behavior.status, { error: "bad" }),
        );
      case "network-error":
        return Promise.reject(new Error(behavior.message));
      case "invalid-json":
        return Promise.resolve(
          buildResponse(200, null, '"bad"', () =>
            Promise.reject(new SyntaxError("Unexpected token")),
          ),
        );
    }
  };
  return {
    fetcher,
    calls,
    setBehavior: (next: FakeFlagsBehavior) => {
      behavior = next;
    },
  };
}

describe("FlagsProvider — evaluation semantics", () => {
  let provider: FlagsProvider | undefined;

  afterEach(async () => {
    await provider?.onClose();
    provider = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("evaluates segment hit, segment miss, rank order, and missing context property", async () => {
    const server = createFakeFlagsServer();
    provider = new FlagsProvider({
      url: "http://flags.invalid:8080/",
      deployment: "scout/prod",
      pollIntervalSeconds: 300,
      fetcher: server.fetcher,
    });
    await provider.initialize();

    // Segment hit
    await expect(
      provider.resolveBooleanEvaluation("ranked-rollouts", false, {
        targetingKey: "entity-1",
        server: "guild-1",
      }),
    ).resolves.toEqual({
      value: true,
      reason: "TARGETING_MATCH",
    });

    // Rank order: rollout 0 (user=blocked-user -> false) beats rollout 1 (server=guild-1 -> true)
    await expect(
      provider.resolveBooleanEvaluation("ranked-rollouts", true, {
        targetingKey: "entity-1",
        user: "blocked-user",
        server: "guild-1",
      }),
    ).resolves.toEqual({
      value: false,
      reason: "TARGETING_MATCH",
    });

    // Segment miss falls back to flag default (false, not call-site default true)
    await expect(
      provider.resolveBooleanEvaluation("ranked-rollouts", true, {
        targetingKey: "entity-1",
        server: "guild-other",
      }),
    ).resolves.toEqual({
      value: false,
      reason: "TARGETING_MATCH",
    });

    // Multi-constraint hit with stringified number and boolean context values
    await expect(
      provider.resolveBooleanEvaluation("multi-constraint", false, {
        targetingKey: "entity-1",
        stage: "beta",
        attempt: 2,
        canary: true,
      }),
    ).resolves.toEqual({ value: true, reason: "TARGETING_MATCH" });

    // Missing context key does not match
    await expect(
      provider.resolveBooleanEvaluation("multi-constraint", true, {
        targetingKey: "entity-1",
        stage: "beta",
        attempt: 2,
      }),
    ).resolves.toEqual({ value: false, reason: "TARGETING_MATCH" });

    // Structured objects in context are dropped rather than matching "[object Object]"
    await expect(
      provider.resolveBooleanEvaluation("object-guard", false, {
        targetingKey: "entity-1",
        nested: { nope: true },
      }),
    ).resolves.toEqual({ value: false, reason: "TARGETING_MATCH" });
  });

  test("treats explicit false as a valid answer and requires non-empty targetingKey", async () => {
    const server = createFakeFlagsServer();
    provider = new FlagsProvider({
      url: "http://flags.invalid:8080",
      deployment: "scout/prod",
      pollIntervalSeconds: 300,
      fetcher: server.fetcher,
    });
    await provider.initialize();

    await expect(
      provider.resolveBooleanEvaluation("plain-on", false, CONTEXT),
    ).resolves.toEqual({ value: true, reason: "TARGETING_MATCH" });

    await expect(
      provider.resolveBooleanEvaluation("plain-off", true, CONTEXT),
    ).resolves.toEqual({ value: false, reason: "TARGETING_MATCH" });

    await expect(
      provider.resolveBooleanEvaluation("plain-on", false, {
        targetingKey: "",
      }),
    ).resolves.toMatchObject({
      value: false,
      errorCode: ErrorCode.TARGETING_KEY_MISSING,
    });
  });

  test("resolves variant strings, valid numbers, and rejects non-numeric or blank numbers", async () => {
    const server = createFakeFlagsServer();
    provider = new FlagsProvider({
      url: "http://flags.invalid:8080",
      deployment: "scout/prod",
      pollIntervalSeconds: 300,
      fetcher: server.fetcher,
    });
    await provider.initialize();

    await expect(
      provider.resolveStringEvaluation("model-name", "fallback", CONTEXT),
    ).resolves.toEqual({
      value: "gpt-6-luna",
      reason: "TARGETING_MATCH",
    });

    await expect(
      provider.resolveNumberEvaluation("token-budget", 1, CONTEXT),
    ).resolves.toEqual({ value: 0.33, reason: "TARGETING_MATCH" });

    await expect(
      provider.resolveNumberEvaluation("zero-budget", 99, CONTEXT),
    ).resolves.toEqual({ value: 0, reason: "TARGETING_MATCH" });

    for (const invalidKey of [
      "non-numeric",
      "empty-variant",
      "whitespace-variant",
      "infinite-variant",
    ]) {
      await expect(
        provider.resolveNumberEvaluation(invalidKey, 42, CONTEXT),
      ).resolves.toMatchObject({
        value: 42,
        reason: "ERROR",
        errorCode: ErrorCode.TYPE_MISMATCH,
      });
    }
  });
});

describe("FlagsProvider — missing keys and type mismatches", () => {
  let provider: FlagsProvider | undefined;

  afterEach(async () => {
    await provider?.onClose();
    provider = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("reports FLAG_NOT_FOUND for missing keys and TYPE_MISMATCH across mismatched accessors and object flags", async () => {
    const server = createFakeFlagsServer();
    provider = new FlagsProvider({
      url: "http://flags.invalid:8080",
      deployment: "scout/prod",
      pollIntervalSeconds: 300,
      fetcher: server.fetcher,
    });
    await provider.initialize();

    server.setBehavior({ kind: "not-modified", etag: '"1"' });
    await expect(
      provider.resolveBooleanEvaluation("unknown-flag", false, CONTEXT),
    ).resolves.toMatchObject({ errorCode: ErrorCode.FLAG_NOT_FOUND });
    await expect(
      provider.resolveStringEvaluation("unknown-flag", "fallback", CONTEXT),
    ).resolves.toMatchObject({ errorCode: ErrorCode.FLAG_NOT_FOUND });
    await expect(
      provider.resolveNumberEvaluation("unknown-flag", 7, CONTEXT),
    ).resolves.toMatchObject({ errorCode: ErrorCode.FLAG_NOT_FOUND });

    // Variant read as boolean -> TYPE_MISMATCH
    await expect(
      provider.resolveBooleanEvaluation("model-name", false, CONTEXT),
    ).resolves.toMatchObject({
      value: false,
      errorCode: ErrorCode.TYPE_MISMATCH,
    });

    // Boolean read as string or number -> TYPE_MISMATCH
    await expect(
      provider.resolveStringEvaluation("plain-on", "fallback", CONTEXT),
    ).resolves.toMatchObject({
      value: "fallback",
      errorCode: ErrorCode.TYPE_MISMATCH,
    });
    await expect(
      provider.resolveNumberEvaluation("plain-on", 5, CONTEXT),
    ).resolves.toMatchObject({
      value: 5,
      errorCode: ErrorCode.TYPE_MISMATCH,
    });

    // Object flags -> TYPE_MISMATCH
    await expect(
      provider.resolveObjectEvaluation("plain-on", { nested: 1 }, CONTEXT),
    ).resolves.toMatchObject({
      value: { nested: 1 },
      errorCode: ErrorCode.TYPE_MISMATCH,
    });
  });

  test("resolves a newly added flag after one refresh and stays FLAG_NOT_FOUND if offline", async () => {
    const server = createFakeFlagsServer();
    provider = new FlagsProvider({
      url: "http://flags.invalid:8080",
      deployment: "scout/prod",
      pollIntervalSeconds: 300,
      fetcher: server.fetcher,
    });
    await provider.initialize();

    server.setBehavior({ kind: "network-error", message: "offline" });
    await expect(
      provider.resolveBooleanEvaluation("newly-added", false, CONTEXT),
    ).resolves.toMatchObject({ errorCode: ErrorCode.FLAG_NOT_FOUND });

    server.setBehavior({
      kind: "snapshot",
      etag: '"2"',
      body: {
        deployment: "scout/prod",
        revision: 2,
        flags: [
          ...DEFAULT_FLAGS,
          { type: "boolean", key: "newly-added", default: true, rollouts: [] },
        ],
      },
    });
    await expect(
      provider.resolveBooleanEvaluation("newly-added", false, CONTEXT),
    ).resolves.toEqual({ value: true, reason: "TARGETING_MATCH" });
  });
});

describe("FlagsProvider — transport, ETag polling, validation, and shutdown", () => {
  let provider: FlagsProvider | undefined;

  afterEach(async () => {
    await provider?.onClose();
    provider = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("sends credentialless GET to encoded snapshot path and handles ETag + 304 conditional polling", async () => {
    vi.useFakeTimers();
    const server = createFakeFlagsServer({
      kind: "snapshot",
      etag: '"1"',
      body: {
        deployment: "starlight-karma-bot/beta",
        revision: 1,
        flags: DEFAULT_FLAGS,
      },
    });
    const ages: number[] = [];
    const failures = vi.fn();
    provider = new FlagsProvider({
      url: "http://flags.flags.svc.cluster.local:8080/",
      deployment: "starlight-karma-bot/beta",
      pollIntervalSeconds: 10,
      fetcher: server.fetcher,
      onRefreshFailure: failures,
      onSnapshotAge: (age) => ages.push(age),
    });

    expect(provider.snapshotAgeSeconds()).toBeUndefined();
    await provider.initialize();

    expect(server.calls[0]).toEqual({
      url: "http://flags.flags.svc.cluster.local:8080/v1/deployments/starlight-karma-bot/beta/snapshot",
      headers: { Accept: "application/json" },
    });
    expect(server.calls[0]?.headers["Authorization"]).toBeUndefined();
    expect(server.calls[0]?.headers["authorization"]).toBeUndefined();
    expect(ages).toEqual([0]);

    // Advance 10s -> conditional poll receives 304 Not Modified, keeps snapshot, resets age to 0
    server.setBehavior({ kind: "not-modified", etag: '"1"' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.calls[1]?.headers).toEqual({
      Accept: "application/json",
      "If-None-Match": '"1"',
    });
    expect(ages.at(-1)).toBe(0);
    await expect(
      provider.resolveBooleanEvaluation("plain-on", false, CONTEXT),
    ).resolves.toMatchObject({ value: true });

    // Advance 10s -> server publishes revision 2 with updated flag value
    server.setBehavior({
      kind: "snapshot",
      etag: '"2"',
      body: {
        deployment: "starlight-karma-bot/beta",
        revision: 2,
        flags: [
          { type: "boolean", key: "plain-on", default: false, rollouts: [] },
        ],
      },
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.calls[2]?.headers["If-None-Match"]).toBe('"1"');
    await expect(
      provider.resolveBooleanEvaluation("plain-on", true, CONTEXT),
    ).resolves.toMatchObject({ value: false });

    // Next poll uses updated ETag "2"
    server.setBehavior({ kind: "not-modified", etag: '"2"' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.calls[3]?.headers["If-None-Match"]).toBe('"2"');
    expect(failures).not.toHaveBeenCalled();
  });

  test("rejects an older snapshot and mismatched 304 without replacing a newer false value", async () => {
    vi.useFakeTimers();
    const server = createFakeFlagsServer();
    const failures = vi.fn();
    provider = new FlagsProvider({
      url: "http://flags.invalid:8080",
      deployment: "scout/prod",
      pollIntervalSeconds: 0,
      fetcher: server.fetcher,
      onRefreshFailure: failures,
    });
    await provider.initialize();
    server.setBehavior({
      kind: "snapshot",
      etag: '"2"',
      body: {
        deployment: "scout/prod",
        revision: 2,
        flags: [
          { type: "boolean", key: "plain-on", default: false, rollouts: [] },
        ],
      },
    });
    await expect(provider.refreshForEvaluation()).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(1000);

    server.setBehavior(DEFAULT_SERVER_BEHAVIOR);
    await expect(provider.refreshForEvaluation()).resolves.toBe(false);
    server.setBehavior({ kind: "not-modified", etag: '"3"' });
    await expect(provider.refreshForEvaluation()).resolves.toBe(false);
    expect(failures).toHaveBeenCalledTimes(2);
    expect(provider.snapshotAgeSeconds()).toBe(1);
    await expect(
      provider.resolveBooleanEvaluation("plain-on", true, CONTEXT),
    ).resolves.toMatchObject({ value: false });

    server.setBehavior({ kind: "not-modified", etag: '"2"' });
    await expect(provider.refreshForEvaluation()).resolves.toBe(true);
    expect(server.calls.at(-1)?.headers["If-None-Match"]).toBe('"2"');
    expect(provider.snapshotAgeSeconds()).toBe(0);
  });

  test("retains last good snapshot and ETag across network, HTTP, and malformed refresh failures", async () => {
    vi.useFakeTimers();
    const server = createFakeFlagsServer();
    const failures = vi.fn();
    provider = new FlagsProvider({
      url: "http://flags.invalid:8080",
      deployment: "scout/prod",
      pollIntervalSeconds: 5,
      fetcher: server.fetcher,
      onRefreshFailure: failures,
    });
    await provider.initialize();

    server.setBehavior({ kind: "network-error", message: "ECONNREFUSED" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(failures).toHaveBeenCalledTimes(1);

    server.setBehavior({ kind: "http-error", status: 503 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(failures).toHaveBeenCalledTimes(2);

    // Malformed 200 payload with a new ETag must not overwrite snapshot or poison ETag
    server.setBehavior({
      kind: "snapshot",
      etag: '"poisoned"',
      body: { deployment: "scout/prod", revision: 2, flags: "not-an-array" },
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(failures).toHaveBeenCalledTimes(3);

    await expect(
      provider.resolveBooleanEvaluation("plain-on", false, CONTEXT),
    ).resolves.toEqual({ value: true, reason: "TARGETING_MATCH" });

    // Next poll still sends last valid ETag "1", not "poisoned"
    server.setBehavior({ kind: "not-modified", etag: '"1"' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(server.calls.at(-1)?.headers["If-None-Match"]).toBe('"1"');
  });

  test("classifies mid-body stream errors and body stalls as unavailable while keeping malformed JSON and schema errors fatal", async () => {
    vi.useFakeTimers();
    let mode: "initial" | "body-drop" | "body-stall" | "malformed-json" =
      "initial";
    provider = new FlagsProvider({
      url: "http://flags.invalid:8080",
      deployment: "scout/prod",
      pollIntervalSeconds: 0,
      requestTimeoutMilliseconds: 500,
      fetcher: () => {
        switch (mode) {
          case "initial":
            return Promise.resolve(
              buildResponse(200, DEFAULT_SERVER_BEHAVIOR.body, '"1"'),
            );
          case "body-drop": {
            const stream = new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode('{"deployment":"scout/prod"'),
                );
                controller.error(new TypeError("terminated"));
              },
            });
            return Promise.resolve(new Response(stream, { status: 200 }));
          }
          case "body-stall":
            return Promise.resolve(
              buildResponse(
                200,
                null,
                '"2"',
                () =>
                  new Promise<never>(() => {
                    /* Stalled body read until requestTimeoutMilliseconds fires. */
                  }),
              ),
            );
          case "malformed-json":
            return Promise.resolve(new Response("{not-json", { status: 200 }));
        }
      },
    });
    await provider.initialize();

    mode = "body-drop";
    await expect(provider.refreshForEvaluation()).resolves.toBe(false);

    mode = "body-stall";
    const stalled = provider.refreshForEvaluation();
    await vi.advanceTimersByTimeAsync(500);
    await expect(stalled).resolves.toBe(false);

    mode = "malformed-json";
    await expect(provider.refreshForEvaluation()).rejects.toThrow(SyntaxError);
  });
});

describe("FlagsProvider — validation and shutdown", () => {
  let provider: FlagsProvider | undefined;

  afterEach(async () => {
    await provider?.onClose();
    provider = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test.each([
    {
      label: "mismatched deployment",
      behavior: {
        kind: "snapshot",
        body: { deployment: "scout/beta", revision: 1, flags: DEFAULT_FLAGS },
      } satisfies FakeFlagsBehavior,
    },
    {
      label: "duplicate flag keys",
      behavior: {
        kind: "snapshot",
        body: {
          deployment: "scout/prod",
          revision: 1,
          flags: [
            { type: "boolean", key: "dup", default: true, rollouts: [] },
            { type: "variant", key: "dup", value: "v" },
          ],
        },
      } satisfies FakeFlagsBehavior,
    },
    {
      label: "negative revision",
      behavior: {
        kind: "snapshot",
        body: { deployment: "scout/prod", revision: -1, flags: [] },
      } satisfies FakeFlagsBehavior,
    },
    {
      label: "empty rollout constraints",
      behavior: {
        kind: "snapshot",
        body: {
          deployment: "scout/prod",
          revision: 1,
          flags: [
            {
              type: "boolean",
              key: "bad-rollout",
              default: false,
              rollouts: [{ constraints: [], result: true }],
            },
          ],
        },
      } satisfies FakeFlagsBehavior,
    },
    {
      label: "unconditional 304 on initial load",
      behavior: {
        kind: "not-modified",
        etag: '"1"',
      } satisfies FakeFlagsBehavior,
    },
    {
      label: "invalid JSON body",
      behavior: { kind: "invalid-json" } satisfies FakeFlagsBehavior,
    },
  ])(
    "initialize rejects $label and leaves provider PROVIDER_NOT_READY",
    async ({ behavior }) => {
      const server = createFakeFlagsServer(behavior);
      provider = new FlagsProvider({
        url: "http://flags.invalid:8080",
        deployment: "scout/prod",
        pollIntervalSeconds: 300,
        fetcher: server.fetcher,
      });

      await expect(provider.initialize()).rejects.toThrow();
      await expect(
        provider.resolveBooleanEvaluation("plain-on", false, CONTEXT),
      ).resolves.toMatchObject({ errorCode: ErrorCode.PROVIDER_NOT_READY });
    },
  );

  test("unrefs timers on startup and cleans up timers and in-flight requests on onClose()", async () => {
    vi.useFakeTimers();
    const server = createFakeFlagsServer();
    let stall = false;
    let startedStalledFetch: (() => void) | undefined;
    const stalledFetchStarted = new Promise<void>((resolve) => {
      startedStalledFetch = resolve;
    });

    provider = new FlagsProvider({
      url: "http://flags.invalid:8080",
      deployment: "scout/prod",
      pollIntervalSeconds: 5,
      onSnapshotAge: () => {
        /* Enables snapshotAgeTimer so cleanup covers both intervals. */
      },
      fetcher: (url, init) => {
        if (!stall) return server.fetcher(url, init);
        startedStalledFetch?.();
        return new Promise<never>(() => {
          /* Stalled until onClose() aborts the provider signal. */
        });
      },
    });

    await provider.initialize();
    expect(vi.getTimerCount()).toBe(2);

    stall = true;
    const inFlight = provider.refreshForEvaluation();
    await stalledFetchStarted;

    await provider.onClose();
    await expect(inFlight).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(provider.snapshotAgeSeconds()).toBeUndefined();
    await expect(
      provider.resolveBooleanEvaluation("plain-on", false, CONTEXT),
    ).resolves.toMatchObject({ errorCode: ErrorCode.PROVIDER_NOT_READY });
  });
});
