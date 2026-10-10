import { proxyActivities } from "@temporalio/workflow";

const { completeActivityQueueReplayProbe } = proxyActivities<{
  completeActivityQueueReplayProbe: () => Promise<string>;
}>({ startToCloseTimeout: "10 seconds", retry: { maximumAttempts: 3 } });

export async function activityQueueReplayProbe(): Promise<string> {
  return completeActivityQueueReplayProbe();
}
