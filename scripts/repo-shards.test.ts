import { describe, expect, test } from "bun:test";
import path from "node:path";
import { z } from "zod";
import {
  matchShard,
  parseShardName,
  SHARD_NAMES,
  shardPathspecs,
  shardTurboInputs,
  type ShardName,
} from "./repo-shards.ts";

function trackedFiles(pathspecs: readonly string[] = []): string[] {
  // Anchor at the repo root: this suite runs with cwd=scripts/, and the
  // pathspecs (".", "packages", …) are meaningless from there.
  const lsFiles = Bun.spawnSync(
    [
      "git",
      "ls-files",
      "-z",
      ...(pathspecs.length > 0 ? ["--", ...pathspecs] : []),
    ],
    { cwd: path.join(import.meta.dir, "..") },
  );
  expect(lsFiles.exitCode).toBe(0);
  return lsFiles.stdout
    .toString()
    .split("\0")
    .filter((file) => file !== "");
}

describe("shard partition", () => {
  // The pathspec encoding is what the ls-files-based checks actually run, so
  // git itself is the oracle here: the four pathspec selections must
  // partition the tracked tree exactly, and matchShard must agree with git
  // on every file. A new top-level directory that fell out of every shard
  // (or into two) fails this test.
  test("pathspecs partition the tracked tree and agree with matchShard", () => {
    const all = trackedFiles();
    const seen = new Map<string, ShardName>();
    for (const shard of SHARD_NAMES) {
      for (const file of trackedFiles(shardPathspecs(shard))) {
        expect(seen.has(file)).toBe(false);
        seen.set(file, shard);
        expect(matchShard(file)).toBe(shard);
      }
    }
    expect(seen.size).toBe(all.length);
  });
});

describe("turbo.json mirror", () => {
  const ShardTaskSchema = z.object({ inputs: z.array(z.string()) });
  const TurboConfigSchema = z
    .object({ tasks: z.record(z.string(), z.unknown()) })
    .loose();
  const SHARDED_CHECKS = ["prettier", "line-endings", "large-files"] as const;

  async function turboTasks(): Promise<Record<string, unknown>> {
    const config = TurboConfigSchema.parse(
      Bun.JSONC.parse(
        await Bun.file(path.join(import.meta.dir, "..", "turbo.json")).text(),
      ),
    );
    return config.tasks;
  }

  test("every check has one root task per shard whose inputs embed the shard globs", async () => {
    const tasks = await turboTasks();
    for (const check of SHARDED_CHECKS) {
      for (const shard of SHARD_NAMES) {
        const key = `//#${check}-${shard}`;
        const task = tasks[key];
        expect(task).toBeDefined();
        const { inputs } = ShardTaskSchema.parse(task);
        for (const glob of shardTurboInputs(shard)) {
          expect(inputs).toContain(glob);
        }
        // The scripts that decide shard membership must invalidate the task.
        expect(inputs).toContain("scripts/repo-shards.ts");
        expect(inputs).toContain("scripts/run-shard-check.ts");
      }
      // The unsharded task name must be gone, not merely joined by shards —
      // otherwise verify.ts could silently run the stale whole-tree check.
      expect(tasks[`//#${check}`]).toBeUndefined();
    }
  });

  test("turbo shard globs agree with matchShard on every tracked file", () => {
    // The turbo inputs are the third encoding of the partition (they drive
    // cache invalidation). Evaluate them as include-then-exclude globs the
    // way turbo does and require exact agreement with matchShard, so a task
    // cannot re-run for another shard's files or miss its own.
    const globs = new Map(
      SHARD_NAMES.map((shard) => [
        shard,
        shardTurboInputs(shard).map((pattern) =>
          pattern.startsWith("!")
            ? { exclude: true, glob: new Bun.Glob(pattern.slice(1)) }
            : { exclude: false, glob: new Bun.Glob(pattern) },
        ),
      ]),
    );
    for (const file of trackedFiles()) {
      for (const [shard, patterns] of globs) {
        let included = false;
        for (const { exclude, glob } of patterns) {
          if (glob.match(file)) included = !exclude;
        }
        expect(
          included,
          `${file} vs ${shard} (matchShard says ${matchShard(file)})`,
        ).toBe(matchShard(file) === shard);
      }
    }
  });
});

describe("parseShardName", () => {
  test("accepts every declared shard", () => {
    for (const shard of SHARD_NAMES) {
      expect(parseShardName(shard)).toBe(shard);
    }
  });

  test("rejects unknown shards with the valid list", () => {
    expect(() => parseShardName("bogus")).toThrow(/scout, homelab/);
  });
});
