import assert from "node:assert/strict";
import path from "node:path";
import { historyToJSON } from "@temporalio/common/lib/proto-utils.js";
import { assertPrivateHistory } from "./history.ts";
import { replayWorkflowFile } from "./process.ts";

/** Schema2 uses the unchanged historical replacement Workflow budgets and private input envelope. */
export async function replayMovieReplacementHistory(
  history: Parameters<typeof historyToJSON>[0],
  input: {
    node: string;
    script: string;
    directory: string;
    name: string;
    childEnvironment: { PATH: string };
  },
) {
  const fileMethods = new Set([
    "prepareSubtitleReplacement",
    "applySubtitleReplacement",
    "reconcileSubtitleReplacement",
  ]);
  const networkMethods = new Set([
    "subtitleReplacementState",
    "beginSubtitleReplacementReconciliation",
    "queueSubtitleReplacementCleanup",
    "finishMediaOperation",
  ]);
  let scheduled = 0;
  for (const event of history.events ?? []) {
    const activity = event.activityTaskScheduledEventAttributes;
    if (activity == null) continue;
    const name = activity.activityType?.name;
    assert.ok(typeof name === "string");
    const files = fileMethods.has(name);
    assert.ok(files || networkMethods.has(name));
    assert.equal(
      Number(activity.startToCloseTimeout?.seconds?.toString()),
      files ? 43_200 : 60,
    );
    assert.equal(
      Number(activity.scheduleToCloseTimeout?.seconds?.toString()),
      315_360_000,
    );
    assert.equal(activity.retryPolicy?.maximumAttempts, files ? 2 : 3);
    assert.equal(
      activity.taskQueue?.name,
      files ? "media-files" : "media-network",
    );
    if (files)
      assert.equal(Number(activity.heartbeatTimeout?.seconds?.toString()), 60);
    scheduled++;
  }
  assert.ok(scheduled > 0);
  const serialized = historyToJSON(history);
  assertPrivateHistory(serialized, [
    "Corrected synthetic human caption dialogue",
    "movieManualReplacementV2",
    "receiptRaw",
    "contentBase64",
    "/data/movies",
    "magnet:",
  ]);
  const filename = path.join(input.directory, `${input.name}.json`);
  await Bun.write(filename, serialized);
  await replayWorkflowFile({ ...input, filename });
}
