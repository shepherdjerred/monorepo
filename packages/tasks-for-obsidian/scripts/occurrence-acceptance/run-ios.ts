import assert from "node:assert/strict";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { readAcceptanceResultReports } from "tasknotes-macos/scripts/acceptance-execution.ts";
import { assertExactNativeResults } from "tasknotes-macos/scripts/acceptance-test-plan.ts";
import {
  seedOccurrenceVault,
  verifyOccurrenceVault,
  templatePath,
  restoredTemplate,
  viewerDay,
} from "tasknotes-macos/scripts/occurrence-acceptance/fixture.ts";
import { runIosNativeJourney } from "../ios-native-e2e.ts";
import { exportIosJourneyAttachments } from "../native-acceptance/attachments.ts";
import { runSelectedIosJourneyTest } from "../native-acceptance/selected-tests.ts";

const tests = [
  "testCompleteChildPreservesPrimaryWhenFutureGenerationFails",
  "testExplicitRepairUndoPreservesTheCompletedPrimary",
  "testRepairAgainSurvivesColdRelaunch",
] as const;

export async function runIosOccurrenceAcceptance(): Promise<void> {
  let day = "";
  let primary: Awaited<ReturnType<typeof verifyOccurrenceVault>> | undefined;
  await runIosNativeJourney({
    kind: "native-occurrence-ios",
    seed: async (vault) => {
      day = viewerDay();
      await seedOccurrenceVault(vault, day);
    },
    execute: async (context) => {
      const { command, device, testRun, evidence, resultBundle } = context;
      await command([
        "plutil",
        "-replace",
        "TasksForObsidianUITests.EnvironmentVariables.FACET_OCCURRENCE_DAY",
        "-string",
        day,
        testRun,
      ]);
      await command([
        "plutil",
        "-replace",
        "TasksForObsidianUITests.SystemAttachmentLifetime",
        "-string",
        "keepNever",
        testRun,
      ]);
      const bundles: string[] = [];
      for (const [index, test] of tests.entries()) {
        assert.equal(
          viewerDay(),
          day,
          "The captured viewer day changed during native acceptance",
        );
        const result = path.join(evidence, `Occurrence-${index + 1}.xcresult`);
        bundles.push(result);
        const failures: unknown[] = [];
        try {
          await runSelectedIosJourneyTest(
            { testRun, device, result, suite: "OccurrenceTaskTests", test },
            command,
          );
          const reports = await readAcceptanceResultReports(
            result,
            {
              summary: path.join(
                evidence,
                `occurrence-${index + 1}.summary.json`,
              ),
              tests: path.join(evidence, `occurrence-${index + 1}.tests.json`),
            },
            command,
          );
          assertExactNativeResults(
            JSON.parse(reports.summaryJSON),
            JSON.parse(reports.testsJSON),
            [test],
            { target: "TasksForObsidianUITests", suite: "OccurrenceTaskTests" },
          );
          const vault = await context.vault();
          assert.equal(await realpath(vault), vault);
          if (index === 0) {
            primary = await verifyOccurrenceVault(vault, day, "completed");
            await mkdir(path.join(vault, "Templates"), { recursive: true });
            await writeFile(path.join(vault, templatePath), restoredTemplate, {
              flag: "wx",
              mode: 0o600,
            });
            await Bun.write(
              path.join(evidence, "primary.json"),
              JSON.stringify(primary, null, 2),
            );
          } else {
            assert.ok(primary);
            const observed = await verifyOccurrenceVault(
              vault,
              day,
              index === 1 ? "undone" : "repaired",
              primary.completedChild,
              primary.completedParent,
            );
            assert.deepEqual(
              observed.rolling,
              primary.rolling,
              "Generate/Repair/Undo must preserve automatic rolling children",
            );
          }
        } catch (error) {
          failures.push(error);
        }
        try {
          await exportIosJourneyAttachments(
            result,
            path.join(evidence, `screenshots-${index + 1}`),
            command,
          );
        } catch (error) {
          failures.push(error);
        }
        await Bun.write(
          path.join(evidence, `occurrence-${index + 1}.json`),
          JSON.stringify(
            {
              schemaVersion: 1,
              test,
              status: failures.length === 0 ? "passed" : "failed",
            },
            null,
            2,
          ),
        );
        if (failures.length > 0)
          throw new AggregateError(
            failures,
            `Native recurrence stopped at ${test}`,
          );
      }
      await command([
        "xcrun",
        "xcresulttool",
        "merge",
        "--output-path",
        resultBundle,
        ...bundles,
      ]);
    },
    verify: async (vault) => {
      assert.ok(primary);
      await verifyOccurrenceVault(
        vault,
        day,
        "repaired",
        primary.completedChild,
        primary.completedParent,
      );
      assert.equal(viewerDay(), day);
    },
  });
}

if (import.meta.main) await runIosOccurrenceAcceptance();
