import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  compactDiagnostics,
  loadVerifyRun,
  type RunSuite,
  type VerifyRun,
} from "#lib/ci/analyze/runs.ts";
import {
  compareSuites,
  slowestSuites,
  summarizeComparison,
} from "#lib/ci/analyze/suites.ts";
import { createS3Client } from "#lib/s3/client.ts";
import { runCi } from "#test/lib/ci/cli-process.ts";

const mocks = vi.hoisted(() => ({ send: vi.fn(), client: vi.fn() }));
vi.mock("#lib/s3/client.ts", () => ({ createS3Client: mocks.client }));

function suite(
  name: string,
  seconds: number,
  report = "pkg/vitest.xml",
): RunSuite {
  return { report, name, seconds, tests: 1, failures: 0 };
}

function run(pipeline: number, suites: RunSuite[] | null): VerifyRun {
  return { pipeline, commit: "a".repeat(40), tasks: [], suites };
}

const diagnostics = {
  pipeline: "42",
  commit: "c".repeat(40),
  workflow: "verify",
  turbo: [
    {
      tasks: [
        {
          taskId: "app#test:ci",
          hash: "1",
          cache: { status: "MISS" },
          dependencies: [],
          execution: { startTime: 1000, endTime: 4000 },
        },
      ],
    },
  ],
};
const recordedSuite = {
  report: "app/vitest.xml",
  name: "app::src/slow.integration.test.ts",
  seconds: 12.25,
  tests: 3,
  failures: 1,
  extra: "dropped",
};

describe("compactDiagnostics suites", () => {
  test("keeps the suite summary fields and nothing else", () => {
    const compacted = compactDiagnostics({
      ...diagnostics,
      testTimings: { version: 1, suites: [recordedSuite] },
    });
    expect(compacted.suites).toEqual([
      {
        report: "app/vitest.xml",
        name: "app::src/slow.integration.test.ts",
        seconds: 12.25,
        tests: 3,
        failures: 1,
      },
    ]);
  });

  test("marks diagnostics without timings as unrecorded, not empty", () => {
    expect(compactDiagnostics(diagnostics).suites).toBeNull();
    expect(
      compactDiagnostics({
        ...diagnostics,
        testTimings: { version: 1, suites: [] },
      }).suites,
    ).toEqual([]);
  });

  test("rejects a suite missing a field the analysis reads", () => {
    expect(() =>
      compactDiagnostics({
        ...diagnostics,
        testTimings: {
          version: 1,
          suites: [{ ...recordedSuite, seconds: -1 }],
        },
      }),
    ).toThrow();
  });
});

describe("slowestSuites", () => {
  test("ranks by seconds and bounds the count", () => {
    const ranked = slowestSuites(
      run(1, [suite("fast", 0.2), suite("slow", 30), suite("medium", 4)]),
      2,
    );
    expect(ranked.map((entry) => entry.name)).toEqual(["slow", "medium"]);
  });

  test("is empty for unrecorded suites", () => {
    expect(slowestSuites(run(1, null), 5)).toEqual([]);
  });
});

describe("compareSuites", () => {
  const before = run(10, [
    suite("steady", 10),
    suite("slower", 100),
    suite("faster", 60),
    suite("only-before", 45),
    suite("split", 5, "pkg/unit.xml"),
    suite("split", 7, "pkg/integration.xml"),
  ]);
  const after = run(11, [
    suite("steady", 10),
    suite("slower", 160),
    suite("faster", 40),
    suite("only-after", 3),
    suite("split", 12),
  ]);

  test("orders changed suites by magnitude, then suites one side executed", () => {
    expect(compareSuites(before, after)).toEqual([
      { name: "slower", before: 100, after: 160, delta: 60 },
      { name: "faster", before: 60, after: 40, delta: -20 },
      { name: "steady", before: 10, after: 10, delta: 0 },
      { name: "split", before: 12, after: 12, delta: 0 },
      { name: "only-before", before: 45, after: null, delta: null },
      { name: "only-after", before: null, after: 3, delta: null },
    ]);
  });

  test("summarizes what only one side executed", () => {
    expect(summarizeComparison(compareSuites(before, after))).toEqual({
      compared: 4,
      onlyBefore: { suites: 1, seconds: 45 },
      onlyAfter: { suites: 1, seconds: 3 },
    });
  });

  test("treats unrecorded suites as none executed", () => {
    const deltas = compareSuites(run(1, null), after);
    expect(deltas.every((delta) => delta.before === null)).toBe(true);
    expect(deltas).toHaveLength(5);
  });
});

/** A GetObject response carrying diagnostics with one recorded suite. */
function body() {
  return {
    Body: {
      transformToWebStream: () =>
        new Blob([
          JSON.stringify({
            ...diagnostics,
            testTimings: { version: 1, suites: [recordedSuite] },
          }),
        ]).stream(),
    },
  };
}

function missing() {
  return Object.assign(new Error("missing object"), { name: "NoSuchKey" });
}

describe("compacted run cache", () => {
  const directories: string[] = [];
  afterEach(async () => {
    mocks.send.mockReset();
    mocks.client.mockReset();
    await Promise.all(
      directories
        .splice(0)
        .map(async (directory) =>
          rm(directory, { recursive: true, force: true }),
        ),
    );
  });

  async function cacheDirectory(): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), "ci-analyze-"));
    directories.push(directory);
    return directory;
  }

  test("ignores compactions written before suites existed", async () => {
    const directory = await cacheDirectory();
    // A format-1 compaction: a valid run shape with no suites field.
    await Bun.write(
      path.join(directory, "42.json"),
      JSON.stringify({ pipeline: 42, commit: "c".repeat(40), tasks: [] }),
    );
    mocks.send.mockResolvedValue(body());
    mocks.client.mockReturnValue({ send: mocks.send });
    const client = await createS3Client("test-profile");
    const first = await loadVerifyRun(client, 42, directory);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(first?.suites).toHaveLength(1);
    expect(first?.tasks).toHaveLength(1);
    const cached = await readdir(directory);
    expect(cached.toSorted()).toEqual(["42.json", "42.v2.json"]);
    const second = await loadVerifyRun(client, 42, directory);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  test("falls back to the nightly extended run's diagnostics, then to none", async () => {
    const directory = await cacheDirectory();
    const keys: string[] = [];
    mocks.send.mockImplementation((command: { input: { Key?: string } }) => {
      keys.push(command.input.Key ?? "");
      return command.input.Key?.endsWith("/diagnostics-verify.json") === true
        ? Promise.reject(missing())
        : Promise.resolve(body());
    });
    mocks.client.mockReturnValue({ send: mocks.send });
    const client = await createS3Client("test-profile");
    const extended = await loadVerifyRun(client, 7, directory);
    expect(keys).toEqual([
      "7/diagnostics-verify.json",
      "7/diagnostics-verify-extended.json",
    ]);
    expect(extended?.suites).toHaveLength(1);

    mocks.send.mockRejectedValue(missing());
    expect(await loadVerifyRun(client, 8, directory)).toBeNull();
    expect(await readdir(directory)).toEqual(["7.v2.json"]);
  });
});

test("suite flags are validated before credentials are needed", async () => {
  const help = await runCi(["analyze", "--help"]);
  expect(help.code, help.error).toBe(0);
  expect(help.output).toContain("--suites");
  for (const args of [
    ["--compare", "5"],
    ["--pipeline", "5"],
    ["--suites", "--compare", "zero"],
    ["--suites", "--pipeline", "0"],
  ]) {
    const { error, code } = await runCi(["analyze", ...args]);
    expect(code, error).toBe(2);
    expect(error).not.toContain("via service-account");
  }
});
