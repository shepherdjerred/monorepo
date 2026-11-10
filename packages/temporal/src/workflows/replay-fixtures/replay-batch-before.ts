import { proxyActivities } from "@temporalio/workflow";

const { completeReplayBatchProbe } = proxyActivities<{
  completeReplayBatchProbe: (step: string) => Promise<string>;
}>({ startToCloseTimeout: "10 seconds", retry: { maximumAttempts: 1 } });

export async function replayBatchStableProbe(): Promise<string> {
  return completeReplayBatchProbe("stable");
}

export async function replayBatchChangedProbe(): Promise<string> {
  return completeReplayBatchProbe("changed");
}
