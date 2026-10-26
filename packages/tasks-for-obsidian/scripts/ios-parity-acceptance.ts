import assert from "node:assert/strict";
import path from "node:path";
import { z } from "zod";
import { readAcceptanceResultReports } from "tasknotes-macos/scripts/acceptance-execution.ts";
import { assertExactNativeResults } from "tasknotes-macos/scripts/acceptance-test-plan.ts";
import {
  runIosNativeJourney,
  type IosNativeJourney,
} from "./ios-native-e2e.ts";
import {
  parityViewer,
  seedParityVault,
  verifyParityVault,
  type ParityViewer,
  type ParityPhase,
} from "./ios-parity-fixture.ts";

const stages: { test: string; phase: ParityPhase }[] = [
  { test: "testTodayUpcomingAndGlobalMetadataSearch", phase: "collections" },
  {
    test: "testTodayCaptureAndQuickSchedulePersistAcrossColdLaunch",
    phase: "mutations",
  },
  {
    test: "testFiltersSortSelectionAndSavedViewEditorRemainReachable",
    phase: "controls",
  },
];

async function retainAttachments(
  context: Parameters<IosNativeJourney["execute"]>[0],
  result: string,
  index: number,
): Promise<void> {
  if (await Bun.file(path.join(result, "Info.plist")).exists()) {
    await context.command([
      "xcrun",
      "xcresulttool",
      "export",
      "attachments",
      "--path",
      result,
      "--output-path",
      path.join(context.evidence, `parity-screenshots-${String(index + 1)}`),
    ]);
  }
}

/** Each selector retains the existing runner's 180s command/120s XCTest bounds. */
export async function runIosParityAcceptance(): Promise<void> {
  let viewer: ParityViewer | undefined;
  await runIosNativeJourney({
    kind: "native-mobile-parity-ios",
    seed: async (vault) => {
      viewer = parityViewer();
      await seedParityVault(vault, viewer.day);
    },
    execute: async (context) => {
      assert.ok(viewer);
      await Bun.write(
        path.join(context.evidence, "parity-viewer.json"),
        JSON.stringify(viewer, null, 2),
      );
      const testConfiguration = z
        .object({
          TasksForObsidianUITests: z.object({
            EnvironmentVariables: z.record(z.string(), z.string()),
          }),
        })
        .parse(
          JSON.parse(
            await context.command(
              ["plutil", "-convert", "json", "-o", "-", context.testRun],
              true,
            ),
          ),
        );
      const environment =
        testConfiguration.TasksForObsidianUITests.EnvironmentVariables;
      for (const [key, value] of Object.entries({
        FACET_PARITY_DAY: viewer.day,
        FACET_PARITY_TIME_ZONE: viewer.timeZone,
      })) {
        await context.command([
          "plutil",
          environment[key] === undefined ? "-insert" : "-replace",
          `TasksForObsidianUITests.EnvironmentVariables.${key}`,
          "-string",
          value,
          context.testRun,
        ]);
      }
      await context.command([
        "plutil",
        "-replace",
        "TasksForObsidianUITests.SystemAttachmentLifetime",
        "-string",
        "keepNever",
        context.testRun,
      ]);
      const results: string[] = [];
      for (const [index, stage] of stages.entries()) {
        assert.deepEqual(
          parityViewer(),
          viewer,
          "The real viewer day/zone changed during native acceptance",
        );
        const result = path.join(
          context.evidence,
          `Parity-${String(index + 1)}.xcresult`,
        );
        results.push(result);
        const failures: unknown[] = [];
        try {
          await context.command([
            "xcodebuild",
            "test-without-building",
            "-xctestrun",
            context.testRun,
            "-destination",
            `platform=iOS Simulator,id=${context.device}`,
            "-parallel-testing-enabled",
            "NO",
            "-resultBundlePath",
            result,
            "-collect-test-diagnostics",
            "never",
            "-test-timeouts-enabled",
            "YES",
            "-maximum-test-execution-time-allowance",
            "120",
            `-only-testing:TasksForObsidianUITests/MobileParityTests/${stage.test}`,
          ]);
          const reports = await readAcceptanceResultReports(
            result,
            {
              summary: path.join(
                context.evidence,
                `parity-${String(index + 1)}.summary.json`,
              ),
              tests: path.join(
                context.evidence,
                `parity-${String(index + 1)}.tests.json`,
              ),
            },
            context.command,
          );
          assertExactNativeResults(
            JSON.parse(reports.summaryJSON),
            JSON.parse(reports.testsJSON),
            [stage.test],
            {
              target: "TasksForObsidianUITests",
              suite: "MobileParityTests",
            },
          );
          const observed = await verifyParityVault(
            await context.vault(),
            viewer.day,
            stage.phase,
          );
          await Bun.write(
            path.join(
              context.evidence,
              `parity-${String(index + 1)}.vault.json`,
            ),
            JSON.stringify(observed, null, 2),
          );
          assert.deepEqual(
            parityViewer(),
            viewer,
            "The real viewer day/zone changed during native acceptance",
          );
        } catch (error) {
          failures.push(error);
        }
        try {
          await retainAttachments(context, result, index);
        } catch (error) {
          failures.push(error);
        }
        await Bun.write(
          path.join(context.evidence, `parity-${String(index + 1)}.json`),
          JSON.stringify(
            {
              schemaVersion: 1,
              test: stage.test,
              phase: stage.phase,
              status: failures.length === 0 ? "passed" : "failed",
            },
            null,
            2,
          ),
        );
        if (failures.length > 0)
          throw new AggregateError(
            failures,
            `Native mobile parity stopped at ${stage.test}`,
          );
      }
      await context.command([
        "xcrun",
        "xcresulttool",
        "merge",
        "--output-path",
        context.resultBundle,
        ...results,
      ]);
    },
    verify: async (vault) => {
      assert.ok(viewer);
      await verifyParityVault(vault, viewer.day, "controls");
      assert.deepEqual(parityViewer(), viewer);
    },
  });
}

if (import.meta.main) await runIosParityAcceptance();
