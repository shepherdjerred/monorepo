import { describe, expect, spyOn, test } from "bun:test";
import { z } from "zod/v4";
import { DiscordRestClient } from "./glitter-corpus-discord-client.ts";
import {
  createGlitterDiscordRateLimitCoordinatorWithStorage,
  DiscordRequestLeaseSchema,
  type DiscordRequestLease,
  type GlitterDiscordRateLimitCoordinator,
  type GlitterDiscordRateLimitStorage,
} from "./glitter-corpus-rate-limit.ts";

const FIRST_HOLDER = "00000000-0000-4000-8000-000000000001";
const SECOND_HOLDER = "00000000-0000-4000-8000-000000000002";

function memoryStorage(): GlitterDiscordRateLimitStorage & {
  current: () => DiscordRequestLease | undefined;
} {
  let value: { etag: string; lease: DiscordRequestLease } | undefined;
  let version = 0;
  return {
    read: async () => value,
    compareAndSwap: async (input) => {
      if (input.expectedEtag !== value?.etag) {
        return false;
      }
      version += 1;
      value = {
        etag: `etag-${String(version)}`,
        lease: DiscordRequestLeaseSchema.parse(input.lease),
      };
      return true;
    },
    current: () => value?.lease,
  };
}

function clientHooks(coordinator: GlitterDiscordRateLimitCoordinator): {
  hooks: {
    cancellationSignal: AbortSignal;
    onProgress: () => void;
    wait: (delayMs: number) => Promise<void>;
    rateLimitCoordinator: GlitterDiscordRateLimitCoordinator;
  };
  waits: number[];
} {
  const waits: number[] = [];
  return {
    hooks: {
      cancellationSignal: new AbortController().signal,
      onProgress: () => {
        // Progress is intentionally consumed by this test hook.
      },
      wait: async (delayMs) => {
        waits.push(delayMs);
      },
      rateLimitCoordinator: coordinator,
    },
    waits,
  };
}

describe("Glitter Discord in-flight request lease", () => {
  test("a concurrent CAS grants exactly one holder", async () => {
    const storage = memoryStorage();
    const first = createGlitterDiscordRateLimitCoordinatorWithStorage(storage);
    const second = createGlitterDiscordRateLimitCoordinatorWithStorage(storage);
    const nowMs = Date.parse("2026-01-01T00:00:00.000Z");

    const results = await Promise.all([
      first.tryAcquire({ holder: FIRST_HOLDER, nowMs }),
      second.tryAcquire({ holder: SECOND_HOLDER, nowMs }),
    ]);

    expect(results.filter((result) => result.acquired)).toHaveLength(1);
    expect(storage.current()?.holder).toBe(
      results[0]?.acquired ? FIRST_HOLDER : SECOND_HOLDER,
    );
  });

  test("a crashed holder blocks requests until its lease expires", async () => {
    const storage = memoryStorage();
    const coordinator =
      createGlitterDiscordRateLimitCoordinatorWithStorage(storage);
    const nowMs = Date.parse("2026-01-01T00:00:00.000Z");

    expect(
      await coordinator.tryAcquire({ holder: FIRST_HOLDER, nowMs }),
    ).toEqual({ acquired: true, retryAfterMs: 0 });
    expect(
      await coordinator.tryAcquire({
        holder: SECOND_HOLDER,
        nowMs: nowMs + 30_000,
      }),
    ).toEqual({ acquired: false, retryAfterMs: 30_000 });
    expect(
      await coordinator.tryAcquire({
        holder: SECOND_HOLDER,
        nowMs: nowMs + 60_000,
      }),
    ).toEqual({ acquired: true, retryAfterMs: 0 });
  });

  test("release extends the ceiling and a stale holder cannot clear a newer lease", async () => {
    const storage = memoryStorage();
    const coordinator =
      createGlitterDiscordRateLimitCoordinatorWithStorage(storage);
    const nowMs = Date.parse("2026-01-01T00:00:00.000Z");
    await coordinator.tryAcquire({ holder: FIRST_HOLDER, nowMs });

    expect(
      await coordinator.release({
        holder: FIRST_HOLDER,
        completedAtMs: nowMs + 500,
        notBeforeMs: nowMs + 5000,
      }),
    ).toBe(true);
    expect(storage.current()).toEqual({
      schemaVersion: 2,
      holder: null,
      leaseExpiresAt: null,
      nextRequestAt: "2026-01-01T00:00:05.000Z",
    });

    await coordinator.tryAcquire({
      holder: SECOND_HOLDER,
      nowMs: nowMs + 5000,
    });
    expect(
      await coordinator.release({
        holder: FIRST_HOLDER,
        completedAtMs: nowMs + 6000,
      }),
    ).toBe(false);
    expect(storage.current()?.holder).toBe(SECOND_HOLDER);
  });
});

function recordingCoordinator(): {
  coordinator: GlitterDiscordRateLimitCoordinator;
  releases: {
    holder: string;
    completedAtMs: number;
    notBeforeMs?: number;
  }[];
} {
  const releases: {
    holder: string;
    completedAtMs: number;
    notBeforeMs?: number;
  }[] = [];
  return {
    coordinator: {
      tryAcquire: async () => ({ acquired: true, retryAfterMs: 0 }),
      release: async (input) => {
        releases.push(input);
        return true;
      },
    },
    releases,
  };
}

describe("Glitter Discord request release", () => {
  test("releases the in-flight lease after a network failure", async () => {
    const recorded = recordingCoordinator();
    let calls = 0;
    const fetchImplementation = Object.assign(
      async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error("network unavailable");
        }
        return new Response('{"ok":true}', { status: 200 });
      },
      { preconnect: globalThis.fetch.preconnect },
    );
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      fetchImplementation,
    );
    try {
      const { hooks } = clientHooks(recorded.coordinator);
      const client = new DiscordRestClient("token", hooks);
      await expect(
        client.get("/test", z.object({ ok: z.boolean() })),
      ).resolves.toMatchObject({ data: { ok: true }, retryCount: 1 });
      expect(recorded.releases).toHaveLength(2);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("holds the lease through a 429 body and releases at the later reset deadline", async () => {
    const recorded = recordingCoordinator();
    let calls = 0;
    const fetchImplementation = Object.assign(
      async () => {
        calls += 1;
        if (calls === 1) {
          return new Response('{"retry_after":2,"global":true}', {
            status: 429,
            headers: {
              "x-ratelimit-remaining": "0",
              "x-ratelimit-reset-after": "5",
            },
          });
        }
        return new Response('{"ok":true}', { status: 200 });
      },
      { preconnect: globalThis.fetch.preconnect },
    );
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      fetchImplementation,
    );
    try {
      const { hooks, waits } = clientHooks(recorded.coordinator);
      const client = new DiscordRestClient("token", hooks);
      await client.get("/test", z.object({ ok: z.boolean() }));
      const firstRelease = recorded.releases[0];
      if (firstRelease?.notBeforeMs === undefined) {
        throw new Error("first release did not carry a reset deadline");
      }
      expect(
        firstRelease.notBeforeMs - firstRelease.completedAtMs,
      ).toBeGreaterThanOrEqual(4990);
      expect(waits).toEqual([2000]);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
