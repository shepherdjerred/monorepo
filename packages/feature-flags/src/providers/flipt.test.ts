import { describe, expect, test } from "vitest";
import { ErrorCode } from "@openfeature/server-sdk";
import snapshot from "@shepherdjerred/feature-flags/providers/fixtures/flipt-snapshot.default.json" with { type: "json" };
import { FliptProvider } from "@shepherdjerred/feature-flags/providers/flipt.ts";
import { createFakeFetcher } from "@shepherdjerred/feature-flags/providers/fake-fetcher.ts";
import { createFliptFetcher } from "@shepherdjerred/feature-flags/providers/flipt-fetcher.ts";

const CONTEXT = { targetingKey: "entity-1" };

async function providerWithFixture(): Promise<FliptProvider> {
  const fake = createFakeFetcher({ kind: "snapshot", body: snapshot });
  const provider = new FliptProvider({
    url: "http://flipt.invalid:8080",
    namespace: "default",
    environment: "default",
    pollIntervalSeconds: 300,
    fetcher: fake.fetcher,
  });
  await provider.initialize();
  return provider;
}

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
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const originalFetch = globalThis.fetch;
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: (url: string, init?: { headers?: Record<string, string> }) => {
        calls.push({ url, headers: init?.headers ?? {} });
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
        environment: "default",
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
      "x-flipt-environment": "default",
      "If-None-Match": "previous-etag",
    });
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
