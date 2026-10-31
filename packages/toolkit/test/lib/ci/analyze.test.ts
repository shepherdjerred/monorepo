import { describe, expect, test } from "vitest";
import { commitsPerFile, taskGraphFromDryRun } from "#lib/ci/analyze/graph.ts";
import {
  criticalTasks,
  hotFiles,
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
  ownInputs = `${id}-inputs`,
): VerifyRun["tasks"][number] {
  return {
    id,
    hash: `${id}-${String(start)}`,
    status,
    seconds: (end - start) / 1000,
    start,
    end,
    dependencies: [],
    ownInputs,
  };
}

const runs: VerifyRun[] = [
  {
    pipeline: 1,
    commit: "a".repeat(40),
    tasks: [
      task("app#test", "MISS", [0, 600_000]),
      task("lib#build", "MISS", [0, 60_000]),
      task("//#lint", "HIT", [0, 10]),
    ],
  },
  {
    pipeline: 2,
    commit: "b".repeat(40),
    tasks: [
      // Same own inputs as run 1, which had finished: an upstream re-run.
      task("app#test", "MISS", [700_000, 1_300_000]),
      task("lib#build", "MISS", [700_000, 760_000], "changed"),
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
    expect(run.tasks).toHaveLength(1);
    expect(run.tasks[0]).toMatchObject({ id: "app#test", seconds: 3 });
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
      },
      {
        taskId: "app#test",
        directory: "packages/app",
        inputs: { "test/app.test.ts": "3" },
        dependents: [],
        command: "vitest run",
      },
      {
        taskId: "//#lint",
        directory: "",
        inputs: { "scripts/lint.ts": "4" },
        dependents: [],
        command: "bun scripts/lint.ts",
      },
      {
        // A transit task: reached, but it executes nothing.
        taskId: "app#check",
        directory: "packages/app",
        inputs: {},
        dependents: [],
        command: "<NONEXISTENT>",
      },
    ],
  });

  test("resolves package-relative and $TURBO_ROOT$ inputs to repository paths", () => {
    expect(graph.inputs.get("lib#build")).toEqual([
      "packages/lib/src/index.ts",
      "packages/shared/config.json",
    ]);
    expect(graph.globalFiles).toEqual(
      expect.arrayContaining([".mise.toml", "bun.lock", "turbo.json"]),
    );
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
    const ranked = hotFiles(graph, commits, costs, 7);
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
