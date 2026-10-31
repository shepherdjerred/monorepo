import path from "node:path";
import { readAcceptanceResultReports } from "tasknotes-macos/scripts/acceptance-execution.ts";
import { assertExactNativeResults } from "tasknotes-macos/scripts/acceptance-test-plan.ts";
import {
  dependencyTest,
  seedDependencyVault,
  verifyDependencyVault,
} from "tasknotes-macos/scripts/dependency-acceptance/fixture.ts";
import { runIosNativeJourney } from "../ios-native-e2e.ts";
import { exportIosJourneyAttachments } from "../native-acceptance/attachments.ts";
import {
  configureIosJourneyTests,
  runSelectedIosJourneyTest,
} from "../native-acceptance/selected-tests.ts";

export async function runIosDependencyAcceptance(): Promise<void> {
  await runIosNativeJourney({
    kind: "native-dependency-editor-ios",
    seed: seedDependencyVault,
    execute: async (context) => {
      await configureIosJourneyTests(context.testRun, {}, context.command);
      const failures: unknown[] = [];
      try {
        await runSelectedIosJourneyTest(
          {
            testRun: context.testRun,
            device: context.device,
            result: context.resultBundle,
            suite: "DependencyEditorUITests",
            test: dependencyTest,
          },
          context.command,
        );
        const reports = await readAcceptanceResultReports(
          context.resultBundle,
          {
            summary: path.join(context.evidence, "dependency.summary.json"),
            tests: path.join(context.evidence, "dependency.tests.json"),
          },
          context.command,
        );
        assertExactNativeResults(
          JSON.parse(reports.summaryJSON),
          JSON.parse(reports.testsJSON),
          [dependencyTest],
          {
            target: "TasksForObsidianUITests",
            suite: "DependencyEditorUITests",
          },
        );
        const hashes = await verifyDependencyVault(await context.vault(), true);
        await Bun.write(
          path.join(context.evidence, "dependency.vault.json"),
          JSON.stringify(hashes, null, 2),
        );
      } catch (error) {
        failures.push(error);
      }
      try {
        await exportIosJourneyAttachments(
          context.resultBundle,
          path.join(context.evidence, "dependency-screenshots"),
          context.command,
        );
      } catch (error) {
        failures.push(error);
      }
      if (failures.length > 0)
        throw new AggregateError(
          failures,
          "Native dependency editor proof failed",
        );
    },
    verify: async (vault) => {
      await verifyDependencyVault(vault, true);
    },
  });
}

if (import.meta.main) await runIosDependencyAcceptance();
