import { afterEach, describe, expect, test, vi } from "vitest";
import { ErrorCode } from "@openfeature/server-sdk";
import snapshot from "@shepherdjerred/feature-flags/providers/fixtures/flipt-snapshot.default.json" with { type: "json" };
import { FliptProvider } from "@shepherdjerred/feature-flags/providers/flipt.ts";
import { createFakeFetcher } from "@shepherdjerred/feature-flags/providers/fake-fetcher.ts";
import { createFliptFetcher } from "@shepherdjerred/feature-flags/providers/flipt-fetcher.ts";

const CONTEXT = { targetingKey: "entity-1" };

async function providerWithFixture(
  fake = createFakeFetcher({ kind: "snapshot", body: snapshot }),
  pollIntervalSeconds = 300,
): Promise<FliptProvider> {
  const provider = new FliptProvider({
    url: "http://flipt.invalid:8080",
    namespace: "default",
    environment: "default",
    pollIntervalSeconds,
    fetcher: fake.fetcher,
  });
  await provider.initialize();
  return provider;
}

describe("FliptProvider — explicit freshness with one client", () => {
  let provider: FliptProvider | undefined;
  afterEach(async () => {
    await provider?.onClose();
    provider = undefined;
    vi.useRealTimers();
  });

  test("outage leaves ordinary cached answers intact, but strict checks fail and later recover", async () => {
    const fake = createFakeFetcher({ kind: "snapshot", body: snapshot });
    provider = await providerWithFixture(fake);
    fake.setBehavior({ kind: "network-error", message: "offline" });
    await expect(provider.refreshForEvaluation()).resolves.toBe(false);
    expect(
      await provider.resolveBooleanEvaluation("plain-on", false, CONTEXT),
    ).toMatchObject({ value: true });
    fake.setBehavior({
      kind: "snapshot",
      body: {
        ...snapshot,
        flags: snapshot.flags.map((flag) => ({ ...flag, enabled: false })),
      },
    });
    await expect(provider.refreshForEvaluation()).resolves.toBe(true);
    expect(
      await provider.resolveBooleanEvaluation("plain-on", true, CONTEXT),
    ).toMatchObject({ value: false });
    expect(fake.callCount()).toBe(3);
  });

  test("corrupt body cannot poison a later same-ETag freshness check", async () => {
    const fake = createFakeFetcher({
      kind: "snapshot",
      body: snapshot,
      etag: "first",
    });
    provider = await providerWithFixture(fake);
    fake.setBehavior({
      kind: "snapshot",
      body: { namespace: { key: "default" }, flags: "invalid" },
      etag: "corrupt",
    });
    await expect(provider.refreshForEvaluation()).rejects.toThrow();
    fake.setBehavior({ kind: "not-modified", etag: "corrupt" });
    await expect(provider.refreshForEvaluation()).rejects.toThrow();
    expect(fake.sentEtags).toEqual([undefined, undefined, undefined]);
    expect(
      await provider.resolveBooleanEvaluation("plain-on", false, CONTEXT),
    ).toMatchObject({ value: true });
    fake.setBehavior({ kind: "snapshot", body: snapshot, etag: "corrupt" });
    await expect(provider.refreshForEvaluation()).resolves.toBe(true);
  });

  test("configured background polling keeps conditional 304 reads and one refresh failure", async () => {
    vi.useFakeTimers();
    const fake = createFakeFetcher({
      kind: "snapshot",
      body: snapshot,
      etag: "first",
    });
    const failure = vi.fn();
    provider = new FliptProvider({
      url: "http://flipt.invalid:8080",
      namespace: "default",
      environment: "default",
      pollIntervalSeconds: 1,
      fetcher: fake.fetcher,
      onRefreshFailure: failure,
    });
    await provider.initialize();
    fake.setBehavior({ kind: "not-modified", etag: "first" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(fake.sentEtags).toEqual([undefined, "first"]);
    fake.setBehavior({ kind: "network-error", message: "offline" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(failure).toHaveBeenCalledTimes(1);
    expect(
      await provider.resolveBooleanEvaluation("plain-on", false, CONTEXT),
    ).toMatchObject({ value: true });
    fake.setBehavior({
      kind: "snapshot",
      body: { namespace: { key: "default" }, flags: "invalid" },
      etag: "corrupt",
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(failure).toHaveBeenCalledTimes(2);
    fake.setBehavior({
      kind: "snapshot",
      etag: "corrupt",
      body: {
        ...snapshot,
        flags: snapshot.flags.map((flag) => ({ ...flag, enabled: false })),
      },
    });
    await expect(provider.refreshForEvaluation()).resolves.toBe(true);
    expect(fake.sentEtags.at(-1)).toBeUndefined();
    expect(
      await provider.resolveBooleanEvaluation("plain-on", true, CONTEXT),
    ).toMatchObject({ value: false });
    await provider.onClose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fake.callCount()).toBe(5);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("concurrent strict refreshes coalesce and shutdown aborts an in-flight transport", async () => {
    const fake = createFakeFetcher({ kind: "snapshot", body: snapshot });
    let pending = false;
    let started: (() => void) | undefined;
    const fetching = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fetcher = (options?: Parameters<typeof fake.fetcher>[0]) => {
      if (!pending) return fake.fetcher(options);
      started?.();
      return new Promise<never>(() => {
        /* The provider's abort boundary must cancel this stalled transport. */
      });
    };
    provider = new FliptProvider({
      url: "http://flipt.invalid:8080",
      namespace: "default",
      environment: "default",
      pollIntervalSeconds: 300,
      fetcher,
    });
    await provider.initialize();
    const first = provider.refreshForEvaluation();
    const second = provider.refreshForEvaluation();
    expect(first).toBe(second);
    await expect(first).resolves.toBe(true);
    expect(fake.callCount()).toBe(2);
    pending = true;
    const closingRefresh = provider.refreshForEvaluation();
    await fetching;
    await provider.onClose();
    await expect(closingRefresh).resolves.toBe(false);
    expect(
      await provider.resolveBooleanEvaluation("plain-on", false, CONTEXT),
    ).toMatchObject({ errorCode: ErrorCode.PROVIDER_NOT_READY });
    await expect(provider.refreshForEvaluation()).resolves.toBe(false);
  });

  test("an invalid initial snapshot never becomes an initialized provider", async () => {
    const fake = createFakeFetcher({
      kind: "snapshot",
      body: { namespace: { key: "default" }, flags: "invalid" },
    });
    provider = new FliptProvider({
      url: "http://flipt.invalid:8080",
      namespace: "default",
      environment: "default",
      pollIntervalSeconds: 300,
      fetcher: fake.fetcher,
    });
    await expect(provider.initialize()).rejects.toThrow();
    await expect(provider.refreshForEvaluation()).resolves.toBe(false);
    expect(
      await provider.resolveBooleanEvaluation("plain-on", false, CONTEXT),
    ).toMatchObject({ errorCode: ErrorCode.PROVIDER_NOT_READY });
  });
});

describe("FliptProvider — serialized refresh transport", () => {
  test("strict refresh waits for background polling and then reads its own complete response", async () => {
    vi.useFakeTimers();
    const fake = createFakeFetcher({
      kind: "snapshot",
      body: snapshot,
      etag: "first",
    });
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider = new FliptProvider({
      url: "http://flipt.invalid:8080",
      namespace: "default",
      environment: "default",
      pollIntervalSeconds: 1,
      fetcher: async (options) => {
        const response = await fake.fetcher(options);
        if (options?.etag !== undefined) await gate;
        return response;
      },
    });
    try {
      await provider.initialize();
      await vi.advanceTimersByTimeAsync(1000);
      const strict = provider.refreshForEvaluation();
      await vi.advanceTimersByTimeAsync(1000);
      expect(fake.sentEtags).toEqual([undefined, "first"]);
      fake.setBehavior({
        kind: "snapshot",
        etag: "second",
        body: {
          ...snapshot,
          flags: snapshot.flags.map((flag) => ({ ...flag, enabled: false })),
        },
      });
      release?.();
      await expect(strict).resolves.toBe(true);
      expect(fake.sentEtags).toEqual([undefined, "first", undefined]);
      expect(
        await provider.resolveBooleanEvaluation("plain-on", true, CONTEXT),
      ).toMatchObject({ value: false });
    } finally {
      release?.();
      await provider.onClose();
      vi.useRealTimers();
    }
  });

  test("unexpected strict 304 is rejected even if it contains a valid old body", async () => {
    const fake = createFakeFetcher({ kind: "snapshot", body: snapshot });
    const json = vi.fn(() => Promise.resolve(snapshot));
    const provider = new FliptProvider({
      url: "http://flipt.invalid:8080",
      namespace: "default",
      environment: "default",
      pollIntervalSeconds: 300,
      fetcher: async (options) => {
        const response = await fake.fetcher(options);
        return response.status === 304 ? { ...response, json } : response;
      },
    });
    try {
      await provider.initialize();
      fake.setBehavior({ kind: "not-modified", etag: "old" });
      await expect(provider.refreshForEvaluation()).rejects.toThrow(
        "Unconditional snapshot request returned 304",
      );
      expect(json).not.toHaveBeenCalled();
      expect(fake.sentEtags).toEqual([undefined, undefined]);
      expect(
        await provider.resolveBooleanEvaluation("plain-on", false, CONTEXT),
      ).toMatchObject({ value: true });
    } finally {
      await provider.onClose();
    }
  });
});

describe("FliptProvider — absence vs. answer", () => {
  test("a flag enabled in the snapshot resolves true", async () => {
    const provider = await providerWithFixture();
    const details = await provider.resolveBooleanEvaluation(
      "plain-on",
      false,
      CONTEXT,
    );
    expect(details.value).toBe(true);
    expect(details.errorCode).toBeUndefined();
    await provider.onClose();
  });

  test("a flag DISABLED in the snapshot resolves false — it is an answer", async () => {
    // The load-bearing case. If this reported FLAG_NOT_FOUND, the config
    // resolver would fall through to an env var still set to true and
    // re-enable exactly what an operator turned off.
    const provider = await providerWithFixture();
    const details = await provider.resolveBooleanEvaluation(
      "plain-off",
      true,
      CONTEXT,
    );
    expect(details.value).toBe(false);
    expect(details.errorCode).toBeUndefined();
    await provider.onClose();
  });

  test("a key absent from the snapshot reports FLAG_NOT_FOUND", async () => {
    const provider = await providerWithFixture();
    const details = await provider.resolveBooleanEvaluation(
      "never-defined",
      false,
      CONTEXT,
    );
    expect(details.errorCode).toBe(ErrorCode.FLAG_NOT_FOUND);
    await provider.onClose();
  });

  test("evaluating before initialize reports PROVIDER_NOT_READY", async () => {
    const provider = new FliptProvider({
      url: "http://flipt.invalid:8080",
      namespace: "default",
      environment: "default",
      pollIntervalSeconds: 300,
      fetcher: createFakeFetcher({ kind: "snapshot", body: snapshot }).fetcher,
    });
    const details = await provider.resolveBooleanEvaluation(
      "plain-on",
      false,
      CONTEXT,
    );
    expect(details.errorCode).toBe(ErrorCode.PROVIDER_NOT_READY);
  });

  test("a missing targeting key is reported, not silently bucketed", async () => {
    // An empty entityId would put the whole fleet in one hash bucket, turning
    // any percentage rollout into 0% or 100%.
    const provider = await providerWithFixture();
    const details = await provider.resolveBooleanEvaluation("ramp-30", false, {
      targetingKey: "",
    });
    expect(details.errorCode).toBe(ErrorCode.TARGETING_KEY_MISSING);
    await provider.onClose();
  });
});

describe("FliptProvider — rollouts", () => {
  test("bucketing is deterministic for the same entity", async () => {
    const provider = await providerWithFixture();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        provider.resolveBooleanEvaluation("ramp-30", false, {
          targetingKey: "stable-entity",
        }),
      ),
    );
    const values = new Set(results.map((r) => r.value));
    expect(values.size).toBe(1);
    await provider.onClose();
  });

  test("a 30% rollout distributes near 30% across many entities", async () => {
    const provider = await providerWithFixture();
    const total = 2000;
    let on = 0;
    for (let index = 0; index < total; index++) {
      const details = await provider.resolveBooleanEvaluation(
        "ramp-30",
        false,
        { targetingKey: `entity-${index.toString()}` },
      );
      if (details.value) {
        on++;
      }
    }
    const ratio = on / total;
    // Wide tolerance: this asserts Flipt is bucketing at all, not that its
    // hash matches a specific distribution.
    expect(ratio).toBeGreaterThan(0.2);
    expect(ratio).toBeLessThan(0.4);
    await provider.onClose();
  });

  test("resolves a variant flag as a string", async () => {
    const provider = await providerWithFixture();
    const details = await provider.resolveStringEvaluation(
      "model-name",
      "fallback",
      CONTEXT,
    );
    expect(details.value).toBe("gpt-5.6-sol");
    await provider.onClose();
  });
});

describe("FliptProvider — availability", () => {
  test("initialize rejects when the snapshot cannot be fetched", async () => {
    // The facade catches this and leaves the provider unusable, so every
    // evaluation then reports PROVIDER_NOT_READY rather than throwing.
    const fake = createFakeFetcher({
      kind: "network-error",
      message: "connect ECONNREFUSED",
    });
    const provider = new FliptProvider({
      url: "http://flipt.invalid:8080",
      namespace: "default",
      environment: "default",
      pollIntervalSeconds: 300,
      fetcher: fake.fetcher,
    });
    await expect(provider.initialize()).rejects.toThrow();
  });

  test("object flags are refused explicitly", async () => {
    const provider = await providerWithFixture();
    const details = await provider.resolveObjectEvaluation(
      "plain-on",
      { a: 1 },
      CONTEXT,
    );
    expect(details.errorCode).toBe(ErrorCode.TYPE_MISMATCH);
    await provider.onClose();
  });
});

describe("createFliptFetcher", () => {
  test("pins the upstream URL and header contract", async () => {
    // This request shape is duplicated from the vendored client and is the
    // thing most likely to drift silently on a Flipt upgrade.
    const calls: {
      url: string;
      headers: Record<string, string>;
      signal: AbortSignal | undefined;
    }[] = [];
    const controller = new AbortController();
    const originalFetch = globalThis.fetch;
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: (
        url: string,
        init?: {
          headers?: Record<string, string>;
          signal?: AbortSignal | undefined;
        },
      ) => {
        calls.push({
          url,
          headers: init?.headers ?? {},
          signal: init?.signal,
        });
        return Promise.resolve(
          new Response("{}", { status: 200, headers: { ETag: "abc" } }),
        );
      },
    });

    try {
      const fetcher = createFliptFetcher({
        // Trailing slash must be normalised away.
        url: "http://flipt.flipt.svc.cluster.local:8080/",
        namespace: "default",
        environment: "beta",
        signal: controller.signal,
      });
      await fetcher({ etag: "previous-etag" });
    } finally {
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        value: originalFetch,
      });
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "http://flipt.flipt.svc.cluster.local:8080/internal/v1/evaluation/snapshot/namespace/default",
    );
    expect(calls[0]?.headers).toEqual({
      Accept: "application/json",
      "x-flipt-accept-server-version": "1.47.0",
      "x-flipt-environment": "beta",
      "If-None-Match": "previous-etag",
    });
    expect(calls[0]?.signal).toBe(controller.signal);
  });

  test("returns a 304 instead of throwing", async () => {
    const originalFetch = globalThis.fetch;
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: () => Promise.resolve(new Response(undefined, { status: 304 })),
    });
    try {
      const fetcher = createFliptFetcher({
        url: "http://flipt.invalid:8080",
        namespace: "default",
        environment: "default",
      });
      await expect(fetcher()).resolves.toMatchObject({ status: 304 });
    } finally {
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        value: originalFetch,
      });
    }
  });

  test("throws on a real HTTP error", async () => {
    const originalFetch = globalThis.fetch;
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: () => Promise.resolve(new Response("nope", { status: 500 })),
    });
    try {
      const fetcher = createFliptFetcher({
        url: "http://flipt.invalid:8080",
        namespace: "default",
        environment: "default",
      });
      await expect(fetcher()).rejects.toThrow(/500/);
    } finally {
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        value: originalFetch,
      });
    }
  });
});
