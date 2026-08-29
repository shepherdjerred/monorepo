import { proxyActivities } from "@temporalio/workflow";

const { completeActivityQueueReplayProbe } = proxyActivities<{
  completeActivityQueueReplayProbe: () => Promise<string>;
}>({ startToCloseTimeout: "10 seconds" });

export async function activityQueueReplayProbe(): Promise<string> {
  return completeActivityQueueReplayProbe();
}
