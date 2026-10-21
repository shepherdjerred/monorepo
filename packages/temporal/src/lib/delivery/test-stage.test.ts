import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  reportSha256,
  suiteUsesVitest,
  TEST_STAGE_RESULT_BOUND,
  testStageResult,
} from "./test-stage.ts";
import { runTestStage } from "#scripts/jobs/test-stage.ts";

function report(input: {
  passed: number;
  failed: number;
  failures?: number;
  nameLength?: number;
}) {
  const names = Array.from(
    { length: input.failures ?? input.failed },
    (_value, index) => `${"x".repeat(input.nameLength ?? 20)} ${String(index)}`,
  );
  return new TextEncoder().encode(
    JSON.stringify({
      numPassedTests: input.passed,
      numFailedTests: input.failed,
      startTime: 1,
      testResults: [
        {
          name: "src/example.test.ts",
          assertionResults: names.map((fullName) => ({
            fullName,
            status: "failed",
          })),
        },
      ],
    }),
  );
}

describe("test stage result", () => {
  it("keeps counts, the report digest and failure names", () => {
    const bytes = report({ passed: 3, failed: 1 });
    expect(
      testStageResult({
        suite: "test",
        workspace: "packages/delivery",
        exitCode: 1,
        durationMs: 42,
        report: bytes,
      }),
    ).toEqual({
      schema: "delivery-test-stage/v1",
      suite: "test",
      workspace: "packages/delivery",
      exitCode: 1,
      passed: 3,
      failed: 1,
      durationMs: 42,
      reportSha256: reportSha256(bytes),
      failures: [`src/example.test.ts: ${"x".repeat(20)} 0`],
      truncated: false,
    });
  });
  it("bounds the result by truncating failure names, never counts", () => {
    const result = testStageResult({
      suite: "test",
      workspace: "packages/delivery",
      exitCode: 1,
      durationMs: 1,
      report: report({
        passed: 0,
        failed: 5000,
        failures: 5000,
        nameLength: 190,
      }),
    });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(
      TEST_STAGE_RESULT_BOUND,
    );
    expect(result.failed).toBe(5000);
    expect(result.truncated).toBe(true);
    expect(result.failures.length).toBeLessThan(200);
  });
  it("reports exit code only for a suite without a report", () => {
    expect(
      testStageResult({
        suite: "test:e2e",
        workspace: "packages/delivery",
        exitCode: 0,
        durationMs: 9,
        report: null,
      }),
    ).toMatchObject({ passed: 0, failed: 0, reportSha256: null });
    expect(
      testStageResult({
        suite: "test:e2e",
        workspace: "packages/delivery",
        exitCode: 2,
        durationMs: 9,
        report: null,
      }),
    ).toMatchObject({ failed: 1, exitCode: 2 });
  });
  it("detects vitest suites from the package script", () => {
    expect(
      suiteUsesVitest(
        "bun --no-install --bun vitest --config ../../vitest.config.ts run src",
      ),
    ).toBe(true);
    expect(suiteUsesVitest("bun --no-install --bun playwright test")).toBe(
      false,
    );
  });
});

describe("test stage Job handler", () => {
  it("runs the named package script at the checkout and shapes the result", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "delivery-test-stage-"));
    try {
      await mkdir(path.join(root, "packages/example"), { recursive: true });
      await Bun.write(
        path.join(root, "packages/example/package.json"),
        JSON.stringify({
          scripts: { "test:e2e": "bun --no-install --bun playwright test" },
        }),
      );
      const calls: { argv: string[]; cwd: string }[] = [];
      const result = await runTestStage(
        {
          deploymentId: "deployment/test",
          stageKey: "test-e2e",
          recipe: "test",
          runnerImage: `docker.io/shepherdjerred/ci-base@sha256:${"a".repeat(64)}`,
          sourceRevision: "b".repeat(40),
          input: { suite: "test:e2e", workspace: "packages/example" },
        },
        {
          root,
          spawn: async (argv, cwd) => {
            calls.push({ argv, cwd });
            return 0;
          },
          now: (() => {
            let tick = 1000;
            return () => (tick += 500);
          })(),
        },
      );
      expect(calls).toEqual([
        {
          argv: ["bun", "run", "test:e2e"],
          cwd: path.join(root, "packages/example"),
        },
      ]);
      expect(result).toMatchObject({
        suite: "test:e2e",
        workspace: "packages/example",
        exitCode: 0,
        passed: 0,
        failed: 0,
        durationMs: 500,
        reportSha256: null,
      });
      await expect(
        runTestStage(
          {
            deploymentId: "deployment/test",
            stageKey: "test-unit",
            recipe: "test",
            runnerImage: `docker.io/shepherdjerred/ci-base@sha256:${"a".repeat(64)}`,
            sourceRevision: "b".repeat(40),
            input: { suite: "missing", workspace: "packages/example" },
          },
          { root, spawn: async () => 0 },
        ),
      ).rejects.toThrow("has no missing script");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
