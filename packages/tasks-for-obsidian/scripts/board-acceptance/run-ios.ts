import assert from "node:assert/strict";
import path from "node:path";
import { readAcceptanceResultReports } from "tasknotes-macos/scripts/acceptance-execution.ts";
import { assertExactNativeResults } from "tasknotes-macos/scripts/acceptance-test-plan.ts";
import { runIosNativeJourney } from "../ios-native-e2e.ts";
import { exportIosJourneyAttachments } from "../native-acceptance/attachments.ts";
import {
  configureIosJourneyTests,
  runSelectedIosJourneyTest,
} from "../native-acceptance/selected-tests.ts";
import {
  boardViewer,
  seedBoardVault,
  verifyBoardVault,
  type BoardViewer,
} from "./fixture.ts";

const tests = [
  "testLowerLoadedCardScrollsWithinItsWorkflowColumn",
  "testLoadMoreMakesCardBeyondTheInitialHundredReachable",
] as const;

/** Independent 120s selectors retain the owned runner's 180s command deadline. */
export async function runIosBoardAcceptance(): Promise<void> {
  let viewer: BoardViewer | undefined;
  await runIosNativeJourney({
    kind: "native-board-ios",
    seed: async (vault) => {
      viewer = boardViewer();
      await seedBoardVault(vault, viewer.day);
    },
    execute: async (context) => {
      assert.ok(viewer);
      await Bun.write(
        path.join(context.evidence, "board-viewer.json"),
        JSON.stringify(viewer, null, 2),
      );
      await configureIosJourneyTests(
        context.testRun,
        {
          FACET_BOARD_DAY: viewer.day,
          FACET_BOARD_TIME_ZONE: viewer.timeZone,
        },
        context.command,
      );
      const results: string[] = [];
      for (const [index, test] of tests.entries()) {
        assert.deepEqual(
          boardViewer(),
          viewer,
          "Real board viewer day/timezone changed",
        );
        const result = path.join(
          context.evidence,
          `Board-${String(index + 1)}.xcresult`,
        );
        results.push(result);
        const failures: unknown[] = [];
        try {
          await runSelectedIosJourneyTest(
            {
              testRun: context.testRun,
              device: context.device,
              result,
              suite: "BoardTaskTests",
              test,
            },
            context.command,
          );
          const reports = await readAcceptanceResultReports(
            result,
            {
              summary: path.join(
                context.evidence,
                `board-${String(index + 1)}.summary.json`,
              ),
              tests: path.join(
                context.evidence,
                `board-${String(index + 1)}.tests.json`,
              ),
            },
            context.command,
          );
          assertExactNativeResults(
            JSON.parse(reports.summaryJSON),
            JSON.parse(reports.testsJSON),
            [test],
            {
              target: "TasksForObsidianUITests",
              suite: "BoardTaskTests",
            },
          );
          const observed = await verifyBoardVault(
            await context.vault(),
            viewer.day,
          );
          await Bun.write(
            path.join(
              context.evidence,
              `board-${String(index + 1)}.vault.json`,
            ),
            JSON.stringify(observed, null, 2),
          );
          assert.deepEqual(
            boardViewer(),
            viewer,
            "Real board viewer day/timezone changed",
          );
        } catch (error) {
          failures.push(error);
        }
        try {
          await exportIosJourneyAttachments(
            result,
            path.join(
              context.evidence,
              `board-screenshots-${String(index + 1)}`,
            ),
            context.command,
          );
        } catch (error) {
          failures.push(error);
        }
        await Bun.write(
          path.join(context.evidence, `board-${String(index + 1)}.json`),
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
            `Native board acceptance stopped at ${test}`,
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
      await verifyBoardVault(vault, viewer.day);
      assert.deepEqual(
        boardViewer(),
        viewer,
        "Real board viewer day/timezone changed",
      );
    },
  });
}

if (import.meta.main) await runIosBoardAcceptance();
