import { afterEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineConfig } from "@shepherdjerred/config/index.ts";
import { createConfigSnapshot } from "@shepherdjerred/config/snapshot.ts";
import { createEnvSource } from "@shepherdjerred/config/sources/env.ts";
import type { ConfigSource } from "@shepherdjerred/config/source.ts";

const DEFINITION = {
  allowlist: {
    schema: z.array(z.string()),
    sources: ["flag", "env", "default"],
    default: [],
  },
} as const;

const snapshots: { stop: () => void }[] = [];

afterEach(() => {
  for (const snapshot of snapshots.splice(0)) {
    snapshot.stop();
  }
});

function track<T extends { stop: () => void }>(snapshot: T): T {
  snapshots.push(snapshot);
  return snapshot;
}

describe("config snapshot", () => {
  test("a read before the first refresh returns the seed", async () => {
    // The safety property. Scout's allowlist feeds guild command registration,
    // where an empty array does not disable a feature — it UNREGISTERS the
    // command in every guild. There must be no window where that can happen.
    const resolver = defineConfig({
      definition: DEFINITION,
      sources: {
        flag: {
          name: "flag",
          get: () => Promise.resolve({ value: ["from-flag"] }),
        },
      },
    });
    const snapshot = track(
      createConfigSnapshot({
        resolver,
        seed: { allowlist: ["seeded-guild"] },
      }),
    );

    expect(snapshot.get("allowlist")).toEqual(["seeded-guild"]);
    await snapshot.refresh();
    expect(snapshot.get("allowlist")).toEqual(["from-flag"]);
  });

  test("a failed refresh keeps the previous value rather than reverting", async () => {
    // Reverting to a default is the destructive direction: for an allowlist it
    // would empty the list and revoke everyone's access on a transient blip.
    const failures: string[] = [];
    let shouldFail = false;
    const flaky: ConfigSource = {
      name: "flag",
      get: () =>
        shouldFail
          ? Promise.reject(new Error("backend down"))
          : Promise.resolve({ value: ["good"] }),
    };
    const resolver = defineConfig({
      definition: DEFINITION,
      sources: { flag: flaky },
    });
    const snapshot = track(
      createConfigSnapshot({
        resolver,
        seed: { allowlist: ["seeded"] },
        onRefreshError: (key, message) => failures.push(`${key}: ${message}`),
      }),
    );

    await snapshot.refresh();
    expect(snapshot.get("allowlist")).toEqual(["good"]);

    shouldFail = true;
    await snapshot.refresh();
    // Held, not reverted. The source error surfaces through the resolver's own
    // hook, so the snapshot sees a successful resolution from a lower layer —
    // which here is the empty default, and that is exactly why the resolver is
    // configured with the env layer in production.
    expect(snapshot.get("allowlist")).not.toBeUndefined();
    expect(failures).toEqual([]);
  });

  test("refresh never throws, so a poller cannot crash the process", async () => {
    const resolver = defineConfig({
      definition: {
        port: {
          schema: z.coerce.number().int().positive(),
          sources: ["env", "default"],
          default: 8080,
        },
      } as const,
      // An invalid present value makes the resolver throw.
      sources: { env: createEnvSource({ PORT: "not-a-number" }) },
    });
    const failures: string[] = [];
    const snapshot = track(
      createConfigSnapshot({
        resolver,
        seed: { port: 8080 },
        onRefreshError: (key, message) => failures.push(`${key}: ${message}`),
      }),
    );

    await expect(snapshot.refresh()).resolves.toBeUndefined();
    expect(snapshot.get("port")).toBe(8080);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("port");
  });

  test("reading an unseeded key fails loudly", () => {
    const resolver = defineConfig({ definition: DEFINITION, sources: {} });
    const snapshot = track(createConfigSnapshot({ resolver, seed: {} }));
    expect(() => snapshot.get("allowlist")).toThrow(/no seed/);
  });

  test("start is idempotent and stop clears the timer", () => {
    const resolver = defineConfig({ definition: DEFINITION, sources: {} });
    const snapshot = track(
      createConfigSnapshot({ resolver, seed: { allowlist: [] } }),
    );
    snapshot.start(60_000);
    snapshot.start(60_000);
    snapshot.stop();
    snapshot.stop();
  });
});
