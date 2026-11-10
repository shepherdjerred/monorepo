import { proxyActivities } from "@temporalio/workflow";

export const { completeReplayBatchProbe } = proxyActivities<{
  completeReplayBatchProbe: (step: string) => Promise<string>;
}>({ startToCloseTimeout: "10 seconds", retry: { maximumAttempts: 1 } });

/** Identical before and after the change; its history must keep replaying. */
export async function stableReplayBatchProbe(): Promise<string> {
  return completeReplayBatchProbe("stable");
}
