import { describe, expect, test } from "vitest";
import {
  reconcileInWaves,
  releasePollDelayMs,
} from "@shepherdjerred/homelab/scripts/argocd/argocd-release-scheduling.ts";

function deferred() {
  const { promise, resolve } = Promise.withResolvers<undefined>();
  return {
    promise,
    release: () => {
      resolve(undefined);
    },
  };
}

describe("release poll cadence", () => {
  test.each([
    [0, 1000],
    [9999, 1000],
    [10_000, 2000],
    [29_999, 2000],
    [30_000, 5000],
  ])("backs off after %d ms", (elapsed, delay) => {
    expect(releasePollDelayMs(elapsed, 60_000)).toBe(delay);
  });
  test("bounds sleep by the remaining deadline and preserves test overrides", () => {
    expect(releasePollDelayMs(40_000, 17)).toBe(17);
    expect(releasePollDelayMs(0, -1)).toBe(0);
    expect(releasePollDelayMs(40_000, 100, 5)).toBe(5);
  });
});

describe("release child waves", () => {
  test("runs at most three children and waits for the whole wave", async () => {
    const barriers = Array.from({ length: 5 }, deferred);
    const started: number[] = [];
    const finished: number[] = [];
    const firstThree = deferred();
    const fourth = deferred();
    const last = deferred();
    const operation = reconcileInWaves(
      [0, 1, 2, 3, 4].map((id) => ({ id, wave: id === 4 ? 1 : 0 })),
      async ({ id }) => {
        started.push(id);
        if (started.length === 3) firstThree.release();
        if (id === 3) fourth.release();
        if (id === 4) last.release();
        await barriers[id]?.promise;
        finished.push(id);
      },
    );
    await firstThree.promise;
    expect(started).toEqual([0, 1, 2]);
    barriers[1]?.release();
    await fourth.promise;
    expect(started).toEqual([0, 1, 2, 3]);
    barriers[3]?.release();
    barriers[0]?.release();
    await Promise.resolve();
    expect(started).not.toContain(4);
    barriers[2]?.release();
    await last.promise;
    expect(finished.toSorted((left, right) => left - right)).toEqual([
      0, 1, 2, 3,
    ]);
    barriers[4]?.release();
    await operation;
    expect(finished).toHaveLength(5);
  });

  test("stops new children on failure and observes every started child", async () => {
    const started: number[] = [];
    const held = deferred();
    const failed = deferred();
    const original = new Error("exact child request failed");
    let returned = false;
    const work = reconcileInWaves(
      [0, 1, 2, 3, 4].map((id) => ({ id, wave: id === 4 ? 1 : 0 })),
      async ({ id }) => {
        started.push(id);
        if (id === 0) {
          failed.release();
          throw original;
        }
        await held.promise;
      },
    );
    const operation = (async () => {
      try {
        await work;
        throw new Error("expected a child failure");
      } catch (error) {
        returned = true;
        return error;
      }
    })();
    await failed.promise;
    await Promise.resolve();
    expect(returned).toBe(false);
    expect(started).toEqual([0, 1, 2]);
    held.release();
    expect(await operation).toBe(original);
    expect(started).toEqual([0, 1, 2]);
  });

  test("sorts waves while preserving input order within each wave", async () => {
    const seen: string[] = [];
    await reconcileInWaves(
      [
        { id: "last", wave: 2 },
        { id: "first", wave: -1 },
        { id: "second", wave: -1 },
      ],
      ({ id }) => {
        seen.push(id);
        return Promise.resolve();
      },
    );
    expect(seen).toEqual(["first", "second", "last"]);
  });
});
