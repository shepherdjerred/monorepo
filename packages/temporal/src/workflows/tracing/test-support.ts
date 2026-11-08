import { proxyActivities, proxySinks, uuid4 } from "@temporalio/workflow";
import type { Sink } from "@temporalio/workflow";

const activities = proxyActivities<{
  probe: () => Promise<string>;
  capture: (id: string) => Promise<string>;
}>({
  startToCloseTimeout: "5 seconds",
});

export async function tracingProbeWorkflow(): Promise<string> {
  return await activities.probe();
}

const { uuidCapture } = proxySinks<{
  uuidCapture: Sink & { record: (id: string) => void };
}>();

export async function tracingReplayProbeWorkflow(): Promise<string> {
  const id = uuid4();
  uuidCapture.record(id);
  return await activities.capture(id);
}
