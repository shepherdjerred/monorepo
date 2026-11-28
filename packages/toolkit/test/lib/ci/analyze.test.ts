import { describe, expect, test } from "vitest";
import {
  commitsPerFile,
  dependencyFieldsChanged,
  taskGraphFromDryRun,
} from "#lib/ci/analyze/graph.ts";
import {
  criticalTasks,
  hotFiles,
  missCauses,
  missCosts,
  repeatedMisses,
  uncachedTasks,
} from "#lib/ci/analyze/report.ts";
import { compactDiagnostics, type VerifyRun } from "#lib/ci/analyze/runs.ts";
import { runCi } from "./cli-process.ts";

function task(
  id: string,
  status: "HIT" | "MISS",
  [start, end]: readonly [number, number],
  fields: { ownInputs?: string; upstream?: string; hash?: string } = {},
): VerifyRun["tasks"][number] {
  return {
    id,
    hash: fields.hash ?? `${id}-${String(start)}`,
    status,
    seconds: (end - start) / 1000,
    start,
    end,
    dependencies: [],
    ownInputs: fields.ownInputs ?? `${id}-inputs`,
    upstream: fields.upstream ?? `${id}-upstream`,
  };
}

const at = (n: number): readonly [number, number] => [
  n * 1_000_000,
  n * 1_000_000 + 100_000,
];

const runs: VerifyRun[] = [
  {
    pipeline: 1,
    commit: "a".repeat(40),
    suites: null,
    tasks: [
      task("app#test", "MISS", [0, 600_000]),
      task("lib#build", "MISS", [0, 60_000]),
      task("//#lint", "HIT", [0, 10]),
    ],
  },
  {
    pipeline: 2,
    commit: "b".repeat(40),
    suites: null,
    tasks: [
      // Same own inputs as run 1, which had finished: an upstream re-run.
      task("app#test", "MISS", [700_000, 1_300_000]),
      task("lib#build", "MISS", [700_000, 760_000], { ownInputs: "changed" }),
    ],
  },
];

describe("compactDiagnostics", () => {
  test("keeps executed tasks and digests own inputs without their paths", () => {
    const run = compactDiagnostics({
      pipeline: "42",
      commit: "c".repeat(40),
      workflow: "verify",
      turbo: [
        {
          tasks: [
            {
              taskId: "app#test",
              hash: "1",
              inputHashes: { "src/secret-name.ts": "abc" },
              cache: { status: "MISS", local: false },
              dependencies: ["lib#build"],
              execution: { startTime: 1000, endTime: 4000, exitCode: 0 },
            },
            {
              taskId: "lib#build",
              hash: "3",
              cache: { status: "HIT" },
              dependencies: [],
              execution: { startTime: 0, endTime: 10, exitCode: 0 },
            },
            {
              taskId: "never#ran",
              hash: "2",
              cache: { status: "MISS" },
              dependencies: [],
            },
          ],
        },
      ],
    });
    expect(run.pipeline).toBe(42);
    expect(run.tasks).toHaveLength(2);
    expect(run.tasks[0]).toMatchObject({ id: "app#test", seconds: 3 });
    // The dependency's hash reaches the task's upstream digest, not its own inputs.
    expect(run.tasks[0]?.upstream).not.toBe(run.tasks[1]?.upstream);
    expect(JSON.stringify(run)).not.toContain("secret-name");
  });

  test("rejects diagnostics missing a field the analysis reads", () => {
    expect(() =>
      compactDiagnostics({ pipeline: 1, commit: "d".repeat(40) }),
    ).toThrow();
  });
});

describe("run analyses", () => {
  test("ranks executed work and ignores cache hits", () => {
    expect(uncachedTasks(runs).map((ranked) => ranked.task)).toEqual([
      "app#test",
      "lib#build",
    ]);
    expect(uncachedTasks(runs)[0]).toMatchObject({
      runs: 2,
      totalSeconds: 1200,
      p50Seconds: 600,
    });
    expect(missCosts(runs).get("lib#build")).toBe(60);
  });

  test("names the task each run finished on", () => {
    expect(criticalTasks(runs)).toEqual([
      { task: "app#test", runs: 2, medianWallSeconds: 600 },
    ]);
  });

  test("flags only misses whose own inputs a finished earlier run executed", () => {
    expect(repeatedMisses(runs)).toEqual([
      {
        task: "app#test",
        misses: 2,
        repeated: 1,
        repeatedSeconds: 600,
      },
    ]);
  });
});

const causeCounts = (...tasks: VerifyRun["tasks"]) =>
  Object.fromEntries(
    missCauses([
      { pipeline: 1, commit: "a".repeat(40), suites: null, tasks },
    ]).map((row) => [row.cause, row.misses]),
  );

const manifest = (extra: object) =>
  JSON.stringify({
    name: "root",
    workspaces: ["packages/*"],
    dependencies: { zod: "4.0.0" },
    ...extra,
  });

describe("miss causes", () => {
  test("classifies each executed task against the latest earlier run with the same own inputs", () => {
    const earlier: VerifyRun = {
      pipeline: 1,
      commit: "a".repeat(40),
      suites: null,
      tasks: [
        task("a#build", "MISS", at(1), {
          ownInputs: "own-a",
          upstream: "up-a",
          hash: "hash-a1",
        }),
        task("b#build", "MISS", at(1), {
          ownInputs: "own-b",
          upstream: "up-b",
          hash: "hash-b1",
        }),
        task("c#build", "MISS", at(1), {
          ownInputs: "own-c",
          upstream: "up-c",
          hash: "hash-c1",
        }),
        task("d#build", "MISS", at(1), {
          ownInputs: "own-d",
          upstream: "up-d",
          hash: "hash-d1",
        }),
      ],
    };
    const later: VerifyRun = {
      pipeline: 2,
      commit: "b".repeat(40),
      suites: null,
      tasks: [
        // No earlier run had these own inputs.
        task("a#build", "MISS", at(2), {
          ownInputs: "own-a-edited",
          upstream: "up-a",
          hash: "hash-a2",
        }),
        // Same own inputs, a dependency hash moved.
        task("b#build", "MISS", at(2), {
          ownInputs: "own-b",
          upstream: "up-b-moved",
          hash: "hash-b2",
        }),
        // Same own inputs and dependencies, the hash still differs.
        task("c#build", "MISS", at(2), {
          ownInputs: "own-c",
          upstream: "up-c",
          hash: "hash-c2",
        }),
        // The very hash already ran once.
        task("d#build", "MISS", at(2), {
          ownInputs: "own-d",
          upstream: "up-d",
          hash: "hash-d1",
        }),
        task("e#build", "HIT", at(2)),
      ],
    };
    const rows = missCauses([earlier, later]);
    const misses = Object.fromEntries(
      rows.map((row) => [row.cause, row.misses]),
    );
    expect(misses).toEqual({
      "own-inputs-changed": 1,
      "upstream-changed": 1,
      "no-own-or-upstream-change": 1,
      "identical-hash-rerun": 1,
      // Run 1's four tasks have no earlier task: the window edge, not a change.
      "unknown-first-seen-in-window": 4,
    });
    expect(rows.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(1);
    expect(rows[0]?.hours).toBeCloseTo(100 / 3600);
  });

  test("finds an identical hash even when a different hash ran in between", () => {
    const counts = causeCounts(
      task("a#build", "MISS", at(1), {
        ownInputs: "own",
        upstream: "up",
        hash: "h1",
      }),
      // An upstream flip, or the other cache domain, runs a different hash.
      task("a#build", "MISS", at(2), {
        ownInputs: "own",
        upstream: "up-flipped",
        hash: "h2",
      }),
      task("a#build", "MISS", at(3), {
        ownInputs: "own",
        upstream: "up",
        hash: "h1",
      }),
    );
    expect(counts["identical-hash-rerun"]).toBe(1);
    expect(counts["upstream-changed"]).toBe(1);
    expect(counts["unknown-first-seen-in-window"]).toBe(1);
  });

  test("compares on start order, so concurrent pipelines have a predecessor", () => {
    const counts = causeCounts(
      task("a#build", "MISS", [0, 600_000], {
        ownInputs: "own",
        upstream: "up",
        hash: "h1",
      }),
      // Starts while the first still runs.
      task("a#build", "MISS", [100_000, 700_000], {
        ownInputs: "own",
        upstream: "up",
        hash: "h2",
      }),
    );
    expect(counts["no-own-or-upstream-change"]).toBe(1);
    expect(counts["own-inputs-changed"]).toBe(0);
  });
});

describe("hot files", () => {
  const graph = taskGraphFromDryRun({
    globalCacheInputs: { files: { ".mise.toml": "1" } },
    tasks: [
      {
        taskId: "lib#build",
        directory: "packages/lib",
        inputs: { "src/index.ts": "1", "../shared/config.json": "2" },
        dependents: ["app#test", "app#check"],
        command: "bun run build",
        hashOfExternalDependencies: "lib-deps",
      },
      {
        taskId: "app#test",
        directory: "packages/app",
        inputs: { "test/app.test.ts": "3" },
        dependents: [],
        command: "vitest run",
        hashOfExternalDependencies: "app-deps",
      },
      {
        taskId: "//#lint",
        directory: "",
        inputs: { "scripts/lint.ts": "4" },
        dependents: [],
        command: "bun scripts/lint.ts",
        hashOfExternalDependencies: "root-deps",
      },
      {
        // A transit task: reached, but it executes nothing.
        taskId: "app#check",
        directory: "packages/app",
        inputs: {},
        dependents: [],
        command: "<NONEXISTENT>",
        hashOfExternalDependencies: "app-deps",
      },
    ],
  });

  test("resolves package-relative and $TURBO_ROOT$ inputs to repository paths", () => {
    expect(graph.inputs.get("lib#build")).toEqual([
      "packages/lib/src/index.ts",
      "packages/shared/config.json",
    ]);
    // Only the configured global files and turbo.json reach every task.
    expect(graph.globalFiles.toSorted()).toEqual([".mise.toml", "turbo.json"]);
    expect(graph.externalDependencyGroups.get("app-deps")).toEqual([
      "app#test",
      "app#check",
    ]);
  });

  test("credits the lockfile to one dependency group per edit and the root package.json by what it changed", () => {
    const rooted = taskGraphFromDryRun({
      globalCacheInputs: { files: {} },
      tasks: [
        {
          taskId: "//#lint",
          directory: "",
          inputs: { "package.json": "1" },
          dependents: [],
          command: "bun scripts/lint.ts",
          hashOfExternalDependencies: "root-deps",
        },
        {
          taskId: "app#test",
          directory: "packages/app",
          inputs: { "package.json": "2" },
          dependents: [],
          command: "vitest run",
          hashOfExternalDependencies: "app-deps",
        },
      ],
    });
    const costs = new Map([
      ["//#lint", 100],
      ["app#test", 300],
    ]);
    const secondsFor = (rootDependencyEdits: number | null) =>
      Object.fromEntries(
        hotFiles(
          rooted,
          {
            commits: new Map([
              ["package.json", 2],
              ["packages/app/package.json", 1],
              ["bun.lock", 1],
              ["turbo.json", 1],
            ]),
            rootDependencyEdits,
          },
          costs,
          7,
        ).map((file) => [file.file, file.secondsPerEdit]),
      );
    // No dependency edit: the root package.json reaches the root task only.
    const none = secondsFor(0);
    expect(none["package.json"]).toBe(100);
    expect(none["packages/app/package.json"]).toBe(300);
    // The lockfile reaches one group on average; turbo.json reaches everything.
    expect(none["bun.lock"]).toBe(200);
    expect(none["turbo.json"]).toBe(400);
    // One of two commits changed dependencies: half global, half root-only.
    expect(secondsFor(1)["package.json"]).toBe(250);
    // Dependency edits are global, and unknown churn is the global upper bound.
    expect(secondsFor(2)["package.json"]).toBe(400);
    expect(secondsFor(null)["package.json"]).toBe(400);
  });

  test("tells a root dependency edit from one that only adds a workspace", () => {
    const base = manifest({});
    expect(
      dependencyFieldsChanged(
        base,
        manifest({ workspaces: ["packages/*", "tools/*"] }),
      ),
    ).toBe(false);
    expect(
      dependencyFieldsChanged(base, manifest({ scripts: { build: "x" } })),
    ).toBe(false);
    expect(
      dependencyFieldsChanged(
        base,
        manifest({ dependencies: { zod: "4.1.0" } }),
      ),
    ).toBe(true);
    expect(
      dependencyFieldsChanged(base, manifest({ overrides: { a: "1" } })),
    ).toBe(true);
    expect(
      dependencyFieldsChanged(
        manifest({ workspaces: { packages: ["a"], catalog: { a: "1" } } }),
        manifest({ workspaces: { packages: ["a"], catalog: { a: "2" } } }),
      ),
    ).toBe(true);
  });

  test("weights each file's commits by the tasks its hash reaches through dependents", () => {
    const commits = commitsPerFile(
      [
        "packages/lib/src/index.ts",
        "",
        "packages/lib/src/index.ts",
        "packages/app/test/app.test.ts",
        ".mise.toml",
        "docs/unhashed.md",
      ].join("\n"),
    );
    const costs = new Map([
      ["lib#build", 60],
      ["app#test", 600],
      ["//#lint", 30],
      // Recorded before app#check became a transit task.
      ["app#check", 900],
    ]);
    const ranked = hotFiles(
      graph,
      { commits, rootDependencyEdits: null },
      costs,
      7,
    );
    expect(ranked.map((file) => file.file)).toEqual([
      "packages/lib/src/index.ts",
      ".mise.toml",
      "packages/app/test/app.test.ts",
    ]);
    expect(ranked[0]).toMatchObject({
      commits: 2,
      tasks: 3,
      secondsPerEdit: 660,
      weeklySeconds: 1320,
    });
    expect(ranked[1]).toMatchObject({ tasks: 4, secondsPerEdit: 690 });
  });
});

test("analyze help and bad flags need no credentials", async () => {
  for (const args of [["--help"], ["--top", "0"], ["unexpected"]]) {
    const { output, error, code } = await runCi(["analyze", ...args]);
    if (args[0] === "--help") {
      expect(code, error).toBe(0);
      expect(output).toContain("hot files");
    } else {
      expect(code, error).toBe(2);
    }
    expect(error).not.toContain("via service-account");
  }
});
