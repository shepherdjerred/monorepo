import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  main,
  packageRoot,
  summarizeRun,
  type QualifyDependencies,
  type SuiteRun,
  type SuiteTarget,
} from "./qualify.ts";
import { QualificationReportSchema } from "./report.ts";

const revision = "0123456789abcdef0123456789abcdef01234567";
const image = `docker.io/shepherdjerred/the-storm-server@sha256:${"a".repeat(64)}`;

function target(suite: "E2E" | "FULL", host: string) {
  return {
    [`STORM_QUALIFY_${suite}_HOST`]: host,
    [`STORM_QUALIFY_${suite}_GAME_PORT`]: "25565",
    [`STORM_QUALIFY_${suite}_RCON_PORT`]: "25575",
    [`STORM_QUALIFY_${suite}_RCON_PASSWORD`]: `${suite}-rcon-password-secret`,
    [`STORM_QUALIFY_${suite}_BRAIN_HOST`]: host,
    [`STORM_QUALIFY_${suite}_BRAIN_PORT`]: "18081",
    [`STORM_QUALIFY_${suite}_FILES_URL`]: `http://${host}:18082`,
    [`STORM_QUALIFY_${suite}_FILES_TOKEN`]: `${suite}-files-token-secret`,
  };
}

const environment = {
  PATH: "/usr/bin",
  // A stray local input must never reach a suite.
  STORM_E2E_PROFILE: "load",
  ...target("E2E", "storm-e2e.mc-sandbox.svc"),
  ...target("FULL", "storm-full.mc-sandbox.svc"),
  STORM_QUALIFY_FULL_QUERY_PORT: "25565",
};

type Assertion = {
  fullName: string;
  status: "passed" | "failed" | "skipped" | "todo";
  duration?: number;
  failureMessages?: string[];
};

function vitestJson(
  files: Record<string, Assertion[]>,
  fileErrors: Record<string, string> = {},
) {
  return {
    numTotalTests: 0,
    success: false,
    testResults: Object.entries(files).map(([file, assertions]) => ({
      name: path.join(packageRoot, file),
      status: assertions.some((a) => a.status === "failed")
        ? "failed"
        : "passed",
      message: fileErrors[file] ?? "",
      startTime: 0,
      endTime: 1,
      assertionResults: assertions.map((assertion) => ({
        ancestorTitles: [],
        title: assertion.fullName,
        fullName: assertion.fullName,
        status: assertion.status,
        duration: assertion.duration ?? null,
        failureMessages: assertion.failureMessages ?? [],
        meta: {},
        tags: [],
      })),
    })),
  };
}

const passingE2e = vitestJson({
  "tests/e2e/plugin.e2e.test.ts": [
    { fullName: "plugin enables", status: "passed", duration: 120 },
  ],
  "tests/e2e/enforcement.e2e.test.ts": [
    { fullName: "active enforcement bans", status: "skipped" },
  ],
});
const passingFull = vitestJson({
  "tests/full/modules.e2e.test.ts": [
    { fullName: "every module enables", status: "passed", duration: 300 },
    { fullName: "discord bridge", status: "todo" },
  ],
});

let scratch: string;
let clock: number;
let claimed: string[];
let runs: { suite: string; env: Record<string, string>; timeoutMs: number }[];

beforeEach(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "storm-qualify-test-"));
  clock = Date.parse("2026-10-21T12:00:00.000Z");
  claimed = [];
  runs = [];
  vi.spyOn(console, "error").mockImplementation(() => {
    // Invocation errors are asserted through the exit code.
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(scratch, { recursive: true, force: true });
});

function dependencies(
  results: Record<string, SuiteRun>,
  claim: (target: SuiteTarget) => Promise<void> = async () => {
    // Fresh server.
  },
): QualifyDependencies {
  return {
    now: () => {
      clock += 1000;
      return new Date(clock);
    },
    claimServer: async (suiteTarget) => {
      claimed.push(suiteTarget.suite);
      await claim(suiteTarget);
    },
    runSuite: async (suiteTarget, timeoutMs) => {
      runs.push({ suite: suiteTarget.suite, env: suiteTarget.env, timeoutMs });
      const result = results[suiteTarget.suite];
      if (result === undefined) throw new Error("unexpected suite");
      clock += 60_000;
      return result;
    },
    log: () => {
      // Quiet.
    },
  };
}

function argv(reportName = "report.json", suites = ["e2e", "full"]) {
  return [
    "--report",
    path.join(scratch, "evidence", reportName),
    "--server-image",
    image,
    "--source-revision",
    revision,
    ...suites.flatMap((suite) => ["--suite", suite]),
  ];
}

async function readReport(reportName = "report.json") {
  return QualificationReportSchema.parse(
    await Bun.file(path.join(scratch, "evidence", reportName)).json(),
  );
}

describe("qualify:sandbox", () => {
  it("runs the named suites in order against their own servers and writes the report", async () => {
    const exitCode = await main(
      argv(),
      environment,
      dependencies({
        e2e: { exitCode: 0, timedOut: false, vitestJson: passingE2e },
        full: { exitCode: 0, timedOut: false, vitestJson: passingFull },
      }),
    );
    expect(exitCode).toBe(0);
    expect(claimed).toEqual(["e2e", "full"]);
    expect(runs.map((run) => [run.suite, run.timeoutMs])).toEqual([
      ["e2e", 3_600_000],
      ["full", 7_200_000],
    ]);
    const e2eEnv = runs[0]?.env;
    expect(e2eEnv).toMatchObject({
      PATH: "/usr/bin",
      STORM_E2E_HOST: "storm-e2e.mc-sandbox.svc",
      STORM_E2E_FILES_TOKEN: "E2E-files-token-secret",
    });
    expect(
      Object.keys(e2eEnv ?? {}).filter(
        (name) =>
          name.startsWith("STORM_QUALIFY_") || name === "STORM_E2E_PROFILE",
      ),
    ).toEqual([]);
    expect(runs[1]?.env["STORM_E2E_QUERY_PORT"]).toBe("25565");

    const report = await readReport();
    expect(report).toMatchObject({
      schemaVersion: 1,
      sourceRevision: revision,
      serverImage: image,
      outcome: "passed",
      startedAt: "2026-10-21T12:00:01.000Z",
    });
    expect(report.suites.map((suite) => suite.name)).toEqual(["e2e", "full"]);
    expect(report.suites[0]).toMatchObject({
      command: "bun run test:e2e",
      target: { host: "storm-e2e.mc-sandbox.svc", gamePort: 25_565 },
      outcome: "passed",
      exitCode: 0,
      durationMs: 61_000,
      tests: { total: 2, passed: 1, failed: 0, skipped: 1, todo: 0 },
      skipped: [
        {
          file: "tests/e2e/enforcement.e2e.test.ts",
          test: "active enforcement bans",
        },
      ],
      error: null,
    });
    expect(report.suites[1]?.tests).toEqual({
      total: 2,
      passed: 1,
      failed: 0,
      skipped: 0,
      todo: 1,
    });
    expect(JSON.stringify(report)).not.toContain("secret");
  });

  it("keeps running after a failing suite and names every failure", async () => {
    const failingE2e = vitestJson(
      {
        "tests/e2e/rwf.e2e.test.ts": [
          {
            fullName: "rwf > records the match",
            status: "failed",
            duration: 4500,
            failureMessages: ["AssertionError: expected 0 to be 1"],
          },
          { fullName: "rwf > opens the lobby", status: "passed" },
        ],
        "tests/e2e/safety.e2e.test.ts": [],
      },
      { "tests/e2e/safety.e2e.test.ts": "Cannot find module './gone.ts'" },
    );
    const exitCode = await main(
      argv(),
      environment,
      dependencies({
        e2e: { exitCode: 1, timedOut: false, vitestJson: failingE2e },
        full: { exitCode: 0, timedOut: false, vitestJson: passingFull },
      }),
    );
    expect(exitCode).toBe(1);
    const report = await readReport();
    expect(report.outcome).toBe("failed");
    expect(report.suites.map((suite) => suite.outcome)).toEqual([
      "failed",
      "passed",
    ]);
    expect(report.suites[0]?.failures).toEqual([
      {
        file: "tests/e2e/rwf.e2e.test.ts",
        test: "rwf > records the match",
        messages: ["AssertionError: expected 0 to be 1"],
        durationMs: 4500,
      },
      {
        file: "tests/e2e/safety.e2e.test.ts",
        test: null,
        messages: ["Cannot find module './gone.ts'"],
        durationMs: null,
      },
    ]);
  });

  it("refuses a server that already served a run, without running its suite", async () => {
    const exitCode = await main(
      argv("reused.json", ["e2e"]),
      environment,
      dependencies({}, async () => {
        throw new Error(
          "storm-e2e.mc-sandbox.svc:25565 already served a qualification run",
        );
      }),
    );
    expect(exitCode).toBe(1);
    expect(runs).toEqual([]);
    const report = await readReport("reused.json");
    expect(report.suites[0]).toMatchObject({
      outcome: "error",
      exitCode: null,
      error:
        "storm-e2e.mc-sandbox.svc:25565 already served a qualification run",
    });
  });

  it("records a suite stopped at its ceiling or without a Vitest report", async () => {
    const exitCode = await main(
      argv(),
      environment,
      dependencies({
        e2e: { exitCode: null, timedOut: true, vitestJson: null },
        full: { exitCode: 1, timedOut: false, vitestJson: null },
      }),
    );
    expect(exitCode).toBe(1);
    const report = await readReport();
    expect(report.suites.map((suite) => suite.error)).toEqual([
      "the suite exceeded its 60-minute ceiling and was stopped",
      "vitest exited 1 without a JSON report; see the job log",
    ]);
  });
});

describe("qualify:sandbox inputs and evidence", () => {
  it("never overwrites earlier evidence", async () => {
    const results = {
      e2e: { exitCode: 0, timedOut: false, vitestJson: passingE2e },
    };
    expect(
      await main(
        argv("once.json", ["e2e"]),
        environment,
        dependencies(results),
      ),
    ).toBe(0);
    await expect(
      main(argv("once.json", ["e2e"]), environment, dependencies(results)),
    ).rejects.toThrow("EEXIST");
  });

  it.each([
    [
      "missing flags",
      () => ["--suite", "e2e"],
      environment,
      ["--report is required", "--server-image is required"],
    ],
    [
      "an image other than the Storm server",
      () => [
        ...argv().slice(0, 3),
        `docker.io/library/paper@sha256:${"b".repeat(64)}`,
      ],
      environment,
      ["--server-image is invalid", "--source-revision is required"],
    ],
    [
      "an unknown suite",
      () => argv("x.json", ["load"]),
      environment,
      ["--suite is invalid"],
    ],
    [
      "a suite without its Query port",
      () => argv(),
      { ...environment, STORM_QUALIFY_FULL_QUERY_PORT: undefined },
      ["full suite (STORM_QUALIFY_FULL_*)", "STORM_E2E_QUERY_PORT is required"],
    ],
    [
      "a misspelled input",
      () => argv(),
      { ...environment, STORM_QUALIFY_E2E_HOSTNAME: "x" },
      ["STORM_QUALIFY_E2E_HOSTNAME is not a qualification input"],
    ],
    [
      "two suites on one server",
      () => argv(),
      { ...environment, ...target("FULL", "storm-e2e.mc-sandbox.svc") },
      ["Each suite needs its own freshly booted server"],
    ],
  ])(
    "refuses %s before running anything",
    async (_case, args, env, expected) => {
      const errors: string[] = [];
      vi.spyOn(console, "error").mockImplementation((message: string) => {
        errors.push(message);
      });
      const exitCode = await main(args(), env, dependencies({}));
      expect(exitCode).toBe(2);
      expect(claimed).toEqual([]);
      for (const text of expected) expect(errors.join("\n")).toContain(text);
      await expect(stat(path.join(scratch, "evidence"))).rejects.toThrow(
        "ENOENT",
      );
    },
  );

  it("treats a clean exit with no passing test as a failure", () => {
    const outcome = summarizeRun(
      {
        exitCode: 0,
        timedOut: false,
        vitestJson: vitestJson({
          "tests/e2e/plugin.e2e.test.ts": [
            { fullName: "skipped", status: "skipped" },
          ],
        }),
      },
      60,
    );
    expect(outcome).toMatchObject({
      outcome: "failed",
      error: "the suite ran no passing test",
    });
  });
});
