import assert from "node:assert/strict";
import path from "node:path";
import { historyToJSON } from "@temporalio/common/lib/proto-utils.js";
import { replayWorkflowFile } from "./process.ts";
import {
  assertPrivateHistory,
  assertScopedMovieActivityBudgets,
} from "./history.ts";

/** Replay the original history with a credentialless Node process after checking actual payloads. */
export async function verifyMovieHistory(
  history: Parameters<typeof historyToJSON>[0],
  options: {
    node: string;
    script: string;
    directory: string;
    name: string;
    childEnvironment: { PATH: string };
  },
) {
  assert.match(options.name, /^[a-z0-9-]+$/u);
  assertScopedMovieActivityBudgets(history);
  const serialized = historyToJSON(history);
  assertPrivateHistory(serialized, [
    "magnet:",
    "Workflow.Fixture",
    "synthetic-workflow-release",
    "synthetic-managed-release",
    "library_management",
    "profileVersionAtCapture",
    "selectionHash",
    "encryptedSource",
    "/data/movies",
    "/downloads/media",
    "Synthetic human caption",
  ]);
  const target = path.join(options.directory, `${options.name}.json`);
  await Bun.write(target, serialized);
  await replayWorkflowFile({ ...options, filename: target });
}
