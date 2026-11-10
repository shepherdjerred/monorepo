import { proxyActivities, sleep } from "@temporalio/workflow";

const { completeReplayBatchProbe } = proxyActivities<{
  completeReplayBatchProbe: (step: string) => Promise<string>;
}>({ startToCloseTimeout: "10 seconds", retry: { maximumAttempts: 1 } });

export async function replayBatchStableProbe(): Promise<string> {
  return completeReplayBatchProbe("stable");
}

/** An unpatched timer before the recorded Activity is a nondeterministic change. */
export async function replayBatchChangedProbe(): Promise<string> {
  await sleep("1 minute");
  return completeReplayBatchProbe("changed");
}
