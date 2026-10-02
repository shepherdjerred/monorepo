import { describe, expect, test, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { watchVault, type VaultWatchSource } from "../engine/watcher.ts";

async function makeVault(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "tn-watch-"));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createWatchSource(): {
  source: VaultWatchSource;
  emitChange: (filename: string | null | undefined) => void;
} {
  let changeListener: ((filename: string | null | undefined) => void) | null =
    null;
  const source: VaultWatchSource = (_vaultPath, onChange) => {
    changeListener = onChange;
    return {
      close: () => {
        changeListener = null;
      },
    };
  };

  return {
    source,
    emitChange: (filename) => {
      if (changeListener === null) {
        throw new Error("watch source was not armed");
      }
      changeListener(filename);
    },
  };
}

describe("watchVault", () => {
  test.each([null, undefined])(
    "a missing filename (%s) requests a full rescan",
    async (filename) => {
      const source = createWatchSource();
      const delivered = Promise.withResolvers<string[]>();
      const watcher = watchVault(
        "/deterministic-test-vault",
        {
          onChanges: delivered.resolve,
        },
        { debounceMs: 0, watchSource: source.source },
      );
      try {
        source.emitChange("changed.md");
        source.emitChange(filename);
        expect(await delivered.promise).toEqual([]);
      } finally {
        watcher.close();
      }
    },
  );

  test("watch errors rescan and rearm, while close cancels pending callbacks", () => {
    vi.useFakeTimers();
    let reportError: ((error: unknown) => void) | undefined;
    let change: ((filename: string | null | undefined) => void) | undefined;
    const closed = vi.fn();
    const source: VaultWatchSource = vi.fn((_path, onChange, onError) => {
      change = onChange;
      reportError = onError;
      return { close: closed };
    });
    const onChanges = vi.fn();
    const onError = vi.fn();
    const watcher = watchVault(
      "/deterministic-test-vault",
      { onChanges, onError },
      {
        watchSource: source,
        debounceMs: 10,
        rearmDelayMs: 100,
      },
    );
    try {
      const error = new Error("watch disconnected");
      reportError?.(error);
      vi.advanceTimersByTime(10);
      expect(onChanges).toHaveBeenCalledWith([]);
      expect(onError).toHaveBeenCalledWith(error);
      vi.advanceTimersByTime(90);
      expect(source).toHaveBeenCalledTimes(2);
      reportError?.(error);
      watcher.close();
      change?.(undefined);
      reportError?.(error);
      vi.advanceTimersByTime(60_000);
      expect(source).toHaveBeenCalledTimes(2);
      expect(onChanges).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      watcher.close();
      vi.useRealTimers();
    }
  });
  test("delivers changed .md paths as a debounced batch", async () => {
    const watchSource = createWatchSource();
    const batches: string[][] = [];
    const delivered = Promise.withResolvers<string[]>();
    const watcher = watchVault(
      "/deterministic-test-vault",
      {
        onChanges: (paths) => {
          batches.push(paths);
          delivered.resolve(paths);
        },
      },
      {
        debounceMs: 0,
        maxWaitMs: 400,
        safetyRescanMs: 60_000,
        watchSource: watchSource.source,
      },
    );
    try {
      watchSource.emitChange("a.md");
      watchSource.emitChange("b.md");
      const batch = await delivered.promise;
      expect(batch.sort()).toEqual(["a.md", "b.md"]);
      expect(batches).toHaveLength(1);
    } finally {
      watcher.close();
    }
  });

  test("real filesystem changes deliver at least one targeted refresh", async () => {
    const vault = await makeVault();
    const delivered = Promise.withResolvers<string[]>();
    const deliveryTimeout = setTimeout(() => {
      delivered.reject(new Error("filesystem watcher delivered no paths"));
    }, 5000);
    const watcher = watchVault(
      vault,
      {
        onChanges: (paths) => {
          if (paths.length > 0) delivered.resolve(paths);
        },
      },
      { debounceMs: 50, maxWaitMs: 400, safetyRescanMs: 60_000 },
    );
    try {
      await sleep(50);
      await writeFile(path.join(vault, "a.md"), "x");
      await writeFile(path.join(vault, "b.md"), "y");
      const targetedPaths = [...new Set(await delivered.promise)].sort();
      expect([["a.md"], ["a.md", "b.md"], ["b.md"]]).toContainEqual(
        targetedPaths,
      );
    } finally {
      clearTimeout(deliveryTimeout);
      watcher.close();
      await rm(vault, { force: true, recursive: true });
    }
  });

  test("a sustained event stream still flushes within max-wait", async () => {
    const watchSource = createWatchSource();
    const batches: string[][] = [];
    const watcher = watchVault(
      "/deterministic-test-vault",
      { onChanges: (paths) => batches.push(paths) },
      {
        debounceMs: 120,
        maxWaitMs: 300,
        safetyRescanMs: 60_000,
        watchSource: watchSource.source,
      },
    );
    try {
      // Emit every 80ms for ~800ms: each event resets the 120ms debounce,
      // so only the max-wait can flush mid-stream.
      for (let i = 0; i < 10; i += 1) {
        watchSource.emitChange("hot.md");
        await sleep(80);
      }
      expect(batches.length).toBeGreaterThanOrEqual(2); // flushed mid-stream
      expect(batches.flat()).toContain("hot.md");
    } finally {
      watcher.close();
    }
  });

  test("non-markdown and dot-path events are ignored", async () => {
    const watchSource = createWatchSource();
    const batches: string[][] = [];
    const watcher = watchVault(
      "/deterministic-test-vault",
      { onChanges: (paths) => batches.push(paths) },
      {
        debounceMs: 40,
        maxWaitMs: 200,
        safetyRescanMs: 60_000,
        watchSource: watchSource.source,
      },
    );
    try {
      watchSource.emitChange("data.json");
      watchSource.emitChange(".hidden.md");
      await sleep(250);
      expect(batches.flat()).toEqual([]);
    } finally {
      watcher.close();
    }
  });

  test("the safety interval requests a full rescan (empty batch)", async () => {
    const watchSource = createWatchSource();
    const batches: string[][] = [];
    const watcher = watchVault(
      "/deterministic-test-vault",
      { onChanges: (paths) => batches.push(paths) },
      {
        debounceMs: 40,
        maxWaitMs: 200,
        safetyRescanMs: 120,
        watchSource: watchSource.source,
      },
    );
    try {
      await sleep(300);
      expect(batches.some((b) => b.length === 0)).toBe(true);
    } finally {
      watcher.close();
    }
  });
});
