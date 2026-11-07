import assert from "node:assert/strict";
import { cp, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { readAcceptanceResultReports } from "tasknotes-macos/scripts/acceptance-execution.ts";
import { assertExactNativeResults } from "tasknotes-macos/scripts/acceptance-test-plan.ts";
import { runIosNativeJourney, verifyVault } from "./ios-native-e2e.ts";
import { exportIosJourneyAttachments } from "./native-acceptance/attachments.ts";
import {
  configureIosJourneyTests,
  runSelectedIosJourneyTest,
} from "./native-acceptance/selected-tests.ts";

const fixture = path.resolve(
  import.meta.dir,
  "../../tasknotes-fixtures/e2e/local-vault",
);
const taskPath = "Tasks/Mutation.md";
const tests = [
  "testUncompleteReturnsThePersistedTaskToInbox",
  "testDeleteUndoRestoresTheReopenedTask",
  "testRestorationSurvivesColdLaunchAndCanCompleteAgain",
] as const;

/** Canonical task metadata matches the Rust capture producer's persisted shape. */
export async function seedIosLocalMutationVault(vault: string): Promise<void> {
  await cp(fixture, vault, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  await Bun.write(
    path.join(vault, taskPath),
    '---\ncontexts: []\npriority: "normal"\nprojects: []\nstatus: "done"\ntags: ["task"]\ntitle: "E2E edited task"\ndateCreated: "2026-01-01T12:00:00Z"\ndateModified: "2026-01-01T12:00:00Z"\ncompletedDate: "2026-01-01"\n---\nSynthetic mutation acceptance body.\n',
  );
}

export async function runIosLocalMutationAcceptance(): Promise<void> {
  let beforeDelete: Uint8Array | undefined;
  await runIosNativeJourney({
    kind: "native-local-mutation-ios",
    seed: seedIosLocalMutationVault,
    execute: async (context) => {
      await configureIosJourneyTests(context.testRun, {}, context.command);
      const results: string[] = [];
      for (const [index, test] of tests.entries()) {
        const result = path.join(
          context.evidence,
          `Mutation-${index + 1}.xcresult`,
        );
        results.push(result);
        const failures: unknown[] = [];
        try {
          const ownedVault = await context.vault();
          assert.equal(await realpath(ownedVault), ownedVault);
          await configureIosJourneyTests(
            context.testRun,
            {
              FACET_MUTATION_RUN_ID: path.basename(context.evidence),
              FACET_MUTATION_TASK_PATH: path.join(ownedVault, taskPath),
            },
            context.command,
          );
          await runSelectedIosJourneyTest(
            {
              testRun: context.testRun,
              device: context.device,
              result,
              suite: "LocalMutationTests",
              test,
            },
            context.command,
          );
          const reports = await readAcceptanceResultReports(
            result,
            {
              summary: path.join(
                context.evidence,
                `mutation-${index + 1}.summary.json`,
              ),
              tests: path.join(
                context.evidence,
                `mutation-${index + 1}.tests.json`,
              ),
            },
            context.command,
          );
          assertExactNativeResults(
            JSON.parse(reports.summaryJSON),
            JSON.parse(reports.testsJSON),
            [test],
            { target: "TasksForObsidianUITests", suite: "LocalMutationTests" },
          );
          const vault = await context.vault();
          for (const relative of [
            "Tasks/Existing.md",
            "Reference.md",
            "tasknotes.yaml",
          ]) {
            assert.deepEqual(
              await readFile(path.join(vault, relative)),
              await readFile(path.join(fixture, relative)),
              `Unrelated fixture changed: ${relative}`,
            );
          }
          const bytes = await Bun.file(path.join(vault, taskPath)).bytes();
          if (index === 0) {
            const frontmatter = /^---\n([\s\S]*?)\n---(?:\n|$)/u.exec(
              new TextDecoder().decode(bytes),
            )?.[1];
            assert.ok(
              frontmatter,
              "Reopened task must retain YAML frontmatter",
            );
            z.object({
              title: z.literal("E2E edited task"),
              status: z.literal("open"),
            }).parse(Bun.YAML.parse(frontmatter));
            beforeDelete = bytes;
            await Bun.write(
              path.join(context.evidence, "before-delete.md"),
              bytes,
            );
          } else if (index === 1) {
            assert.ok(beforeDelete);
            assert.deepEqual(
              bytes,
              beforeDelete,
              "Undo must restore exact pre-delete Markdown bytes",
            );
            await Bun.write(
              path.join(context.evidence, "after-undo.md"),
              bytes,
            );
          } else {
            await verifyVault(vault);
          }
        } catch (error) {
          failures.push(error);
        }
        try {
          await exportIosJourneyAttachments(
            result,
            path.join(context.evidence, `mutation-screenshots-${index + 1}`),
            context.command,
          );
        } catch (error) {
          failures.push(error);
        }
        await Bun.write(
          path.join(context.evidence, `mutation-${index + 1}.json`),
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
            `Local mutation stopped at ${test}`,
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
    verify: verifyVault,
  });
}

if (import.meta.main) await runIosLocalMutationAcceptance();
