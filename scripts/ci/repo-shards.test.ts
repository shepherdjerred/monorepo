import { describe, expect, test } from "vitest";
import path from "node:path";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
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
    { cwd: path.join(import.meta.dir, "..", "..") },
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
        await Bun.file(
          path.join(import.meta.dir, "..", "..", "turbo.json"),
        ).text(),
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
        expect(inputs).toContain("scripts/ci/repo-shards.ts");
        expect(inputs).toContain("scripts/ci/run-shard-check.ts");
        if (check === "prettier") {
          expect(inputs).toContain("bun.lock");
          expect(inputs).toContain("package.json");
        }
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

  test("root check hashes ignore object storage but retain staging and source changes", async () => {
    const repository = path.join(import.meta.dir, "..", "..");
    const fixture = await mkdtemp(path.join(tmpdir(), "root-check-inputs-"));
    const tasks = await turboTasks();
    const names = SHARDED_CHECKS.map((check) => `${check}-root`);
    const SummarySchema = z.object({
      tasks: z.array(
        z.object({
          task: z.string(),
          hash: z.string(),
          inputs: z.record(z.string(), z.string()),
        }),
      ),
    });
    const git = (...args: string[]) => {
      const result = Bun.spawnSync(["git", ...args], { cwd: fixture });
      expect(result.exitCode).toBe(0);
    };
    const hashes = () => {
      const result = Bun.spawnSync(
        [
          path.join(repository, "node_modules/.bin/turbo"),
          "run",
          ...names,
          "--dry=json",
        ],
        {
          cwd: fixture,
          env: { ...Bun.env, TURBO_TELEMETRY_DISABLED: "1" },
        },
      );
      expect(result.exitCode).toBe(0);
      return SummarySchema.parse(JSON.parse(result.stdout.toString())).tasks;
    };
    try {
      await mkdir(path.join(fixture, "packages/probe"), { recursive: true });
      await Bun.write(
        path.join(fixture, "packages/probe/package.json"),
        '{"name":"probe","private":true}',
      );
      await Bun.write(
        path.join(fixture, "package.json"),
        JSON.stringify({
          name: "root-check-input-probe",
          private: true,
          packageManager: `bun@${Bun.version}`,
          workspaces: ["packages/*"],
          scripts: Object.fromEntries(names.map((name) => [name, "true"])),
        }),
      );
      await Bun.write(
        path.join(fixture, "turbo.json"),
        JSON.stringify({
          tasks: Object.fromEntries(
            names.map((name) => [
              `//#${name}`,
              ShardTaskSchema.parse(tasks[`//#${name}`]),
            ]),
          ),
        }),
      );
      await Bun.write(path.join(fixture, ".gitignore"), ".turbo/\n");
      await Bun.write(
        path.join(fixture, "source.ts"),
        "export const value = 1;\n",
      );
      git("init", "--quiet");
      git("add", ".");
      const original = hashes();
      await Bun.write(
        path.join(fixture, ".git/objects/info/input-probe"),
        "object storage changed\n",
      );
      const objectsChanged = hashes();
      await Bun.write(path.join(fixture, "new-source.ts"), "const value=1\n");
      const beforeStaging = hashes();
      git("add", "new-source.ts");
      const afterStaging = hashes();
      await Bun.write(
        path.join(fixture, "source.ts"),
        "export const value = 2;\n",
      );
      const sourceChanged = hashes();
      await Bun.write(path.join(fixture, ".gitignore"), ".turbo/\nignored/\n");
      const hiddenSourceChanged = hashes();
      for (const task of original) {
        const hashFor = (summary: z.infer<typeof SummarySchema>["tasks"]) =>
          summary.find((entry) => entry.task === task.task)?.hash;
        expect(Object.keys(task.inputs)).toContain(".git/index");
        expect(
          Object.keys(
            objectsChanged.find((entry) => entry.task === task.task)?.inputs ??
              {},
          ),
        ).not.toContain(".git/objects/info/input-probe");
        expect(hashFor(objectsChanged)).toBe(task.hash);
        expect(hashFor(afterStaging)).not.toBe(hashFor(beforeStaging));
        expect(hashFor(sourceChanged)).not.toBe(hashFor(afterStaging));
        expect(hashFor(hiddenSourceChanged)).not.toBe(hashFor(sourceChanged));
      }
    } finally {
      await rm(fixture, { recursive: true, force: true });
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
