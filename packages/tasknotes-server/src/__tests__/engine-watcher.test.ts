import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { watchVault } from "../engine/watcher.ts";

async function makeVault(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "tn-watch-"));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("watchVault", () => {
  test("delivers changed .md paths as a debounced batch", async () => {
    const vault = await makeVault();
    const batches: string[][] = [];
    const observedPaths = new Set<string>();
    const delivered = Promise.withResolvers<null>();
    const deliveryTimeout = setTimeout(() => {
      delivered.reject(
        new Error(
          `watcher did not deliver both paths; received ${JSON.stringify([...observedPaths].sort())}`,
        ),
      );
    }, 5000);
    const watcher = watchVault(
      vault,
      {
        onChanges: (paths) => {
          batches.push(paths);
          for (const changedPath of paths) {
            observedPaths.add(changedPath);
          }
          if (observedPaths.has("a.md") && observedPaths.has("b.md")) {
            clearTimeout(deliveryTimeout);
            delivered.resolve(null);
          }
        },
      },
      { debounceMs: 50, maxWaitMs: 400, safetyRescanMs: 60_000 },
    );
    try {
      await sleep(100); // let the watch arm
      await writeFile(path.join(vault, "a.md"), "x");
      await sleep(20); // macOS FSEvents can coalesce simultaneous writes
      await writeFile(path.join(vault, "b.md"), "y");
      await delivered.promise;
      expect(batches.flat().sort()).toEqual(["a.md", "b.md"]);
    } finally {
      clearTimeout(deliveryTimeout);
      watcher.close();
    }
  });

  test("a sustained event stream still flushes within max-wait", async () => {
    const vault = await makeVault();
    const batches: string[][] = [];
    const watcher = watchVault(
      vault,
      { onChanges: (paths) => batches.push(paths) },
      { debounceMs: 120, maxWaitMs: 300, safetyRescanMs: 60_000 },
    );
    try {
      await sleep(50);
      // Write every 80ms for ~800ms: each write resets the 120ms debounce,
      // so only the max-wait can flush mid-stream.
      for (let i = 0; i < 10; i += 1) {
        await writeFile(path.join(vault, "hot.md"), String(i));
        await sleep(80);
      }
      expect(batches.length).toBeGreaterThanOrEqual(2); // flushed mid-stream
      expect(batches.flat()).toContain("hot.md");
    } finally {
      watcher.close();
    }
  });

  test("non-markdown and dot-path events are ignored", async () => {
    const vault = await makeVault();
    const batches: string[][] = [];
    const watcher = watchVault(
      vault,
      { onChanges: (paths) => batches.push(paths) },
      { debounceMs: 40, maxWaitMs: 200, safetyRescanMs: 60_000 },
    );
    try {
      await sleep(50);
      await writeFile(path.join(vault, "data.json"), "{}");
      await writeFile(path.join(vault, ".hidden.md"), "x");
      await sleep(250);
      expect(batches.flat()).toEqual([]);
    } finally {
      watcher.close();
    }
  });

  test("the safety interval requests a full rescan (empty batch)", async () => {
    const vault = await makeVault();
    const batches: string[][] = [];
    const watcher = watchVault(
      vault,
      { onChanges: (paths) => batches.push(paths) },
      { debounceMs: 40, maxWaitMs: 200, safetyRescanMs: 120 },
    );
    try {
      await sleep(300);
      expect(batches.some((b) => b.length === 0)).toBe(true);
    } finally {
      watcher.close();
    }
  });
});
