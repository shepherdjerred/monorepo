import assert from "node:assert/strict";
import path from "node:path";
import {
  assertExactLaunchSmokeResults,
  assertExactStandaloneResults,
  launchSmokeSelector,
  standaloneSelector,
  standaloneTests,
  type StandaloneTest,
} from "./acceptance-test-plan.ts";

export type AcceptanceCommand = (
  argv: string[],
  capture?: boolean,
) => Promise<string>;

export type AcceptanceStage = {
  resultBundle: string;
  receipt: string;
} & (
  | { kind: "launch-smoke"; selector: typeof launchSmokeSelector }
  | { kind: "workflow"; selector: string; test: StandaloneTest }
);

export function acceptanceStages(
  tests: readonly StandaloneTest[],
  evidence: string,
  smokeOnly: boolean,
): AcceptanceStage[] {
  assert.ok(tests.length > 0, "At least one workflow must be selected");
  assert.equal(
    new Set(tests).size,
    tests.length,
    "Duplicate workflow selection",
  );
  assert.ok(
    tests.every((test) => standaloneTests.includes(test)),
    "Unknown workflow",
  );
  const stages: AcceptanceStage[] = [
    {
      kind: "launch-smoke",
      selector: launchSmokeSelector,
      resultBundle: path.join(evidence, "LaunchSmoke.xcresult"),
      receipt: path.join(evidence, "launch-smoke.json"),
    },
  ];
  if (!smokeOnly) {
    for (const [index, test] of tests.entries()) {
      stages.push({
        kind: "workflow",
        test,
        selector: standaloneSelector(test),
        resultBundle: path.join(evidence, `Workflow-${index + 1}.xcresult`),
        receipt: path.join(evidence, `workflow-${index + 1}.json`),
      });
    }
  }
  return stages;
}

/** Each exact singleton result gates the next process; no polling or retries. */
export async function executeAcceptanceStages(
  stages: readonly AcceptanceStage[],
  testRun: string,
  command: AcceptanceCommand,
): Promise<void> {
  for (const stage of stages) {
    const receipt = {
      schemaVersion: 1,
      kind: stage.kind,
      selector: stage.selector,
      resultBundle: path.basename(stage.resultBundle),
    };
    await Bun.write(
      stage.receipt,
      JSON.stringify({ ...receipt, status: "running" }, null, 2),
    );
    const failures: unknown[] = [];
    try {
      await command([
        "xcodebuild",
        "test-without-building",
        "-xctestrun",
        testRun,
        "-destination",
        "platform=macOS",
        "-parallel-testing-enabled",
        "NO",
        "-resultBundlePath",
        stage.resultBundle,
        "-collect-test-diagnostics",
        "never",
        `-only-testing:${stage.selector}`,
      ]);
    } catch (error) {
      failures.push(error);
    }
    try {
      const reports = await Promise.allSettled(
        ["summary", "tests"].map(async (kind) => {
          const report = await command(
            [
              "xcrun",
              "xcresulttool",
              "get",
              "test-results",
              kind,
              "--compact",
              "--path",
              stage.resultBundle,
            ],
            true,
          );
          await Bun.write(`${stage.receipt}.${kind}.json`, report);
          return report;
        }),
      );
      const summaryJSON =
        reports[0]?.status === "fulfilled" ? reports[0].value : undefined;
      const testsJSON =
        reports[1]?.status === "fulfilled" ? reports[1].value : undefined;
      for (const report of reports)
        if (report.status === "rejected") failures.push(report.reason);
      assert.ok(
        summaryJSON && testsJSON,
        "Exact singleton result documents are required",
      );
      const summary: unknown = JSON.parse(summaryJSON);
      const tests: unknown = JSON.parse(testsJSON);
      if (stage.kind === "launch-smoke")
        assertExactLaunchSmokeResults(summary, tests);
      else assertExactStandaloneResults(summary, tests, [stage.test]);
    } catch (error) {
      failures.push(error);
    }
    await Bun.write(
      stage.receipt,
      JSON.stringify(
        {
          ...receipt,
          status: failures.length === 0 ? "passed" : "failed",
        },
        null,
        2,
      ),
    );
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `Native acceptance stopped at ${stage.selector}`,
      );
    }
  }
}
