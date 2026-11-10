import { sleep } from "@temporalio/workflow";
import {
  completeReplayBatchProbe,
  stableReplayBatchProbe,
} from "./replay-batch-shared.ts";

/** An unpatched timer before the recorded Activity is a nondeterministic change. */
export async function replayBatchChangedProbe(): Promise<string> {
  await sleep("1 minute");
  return completeReplayBatchProbe("changed");
}

export async function replayBatchStableProbe(): Promise<string> {
  return stableReplayBatchProbe();
}
