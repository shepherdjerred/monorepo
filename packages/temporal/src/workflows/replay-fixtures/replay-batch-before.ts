import {
  completeReplayBatchProbe,
  stableReplayBatchProbe,
} from "./replay-batch-shared.ts";

export async function replayBatchStableProbe(): Promise<string> {
  return stableReplayBatchProbe();
}

export async function replayBatchChangedProbe(): Promise<string> {
  return completeReplayBatchProbe("changed");
}
