import {
  ScoutQueueCanaryInputSchema,
  ScoutQueueCanaryProbeResultSchema,
  type ScoutQueueCanaryInput,
  type ScoutQueueCanaryProbeResult,
} from "#src/contracts.ts";
import {
  backgroundActivities,
  interactiveActivities,
  lakeActivities,
  realtimeActivities,
} from "./activity-options.ts";
import { scoutTaskQueues } from "#src/identifiers.ts";
import { setWorkflowPhase } from "#src/workflow-ui-interceptor.ts";

export async function scoutQueueCanaryWorkflow(
  rawInput: ScoutQueueCanaryInput,
): Promise<ScoutQueueCanaryProbeResult[]> {
  const input = ScoutQueueCanaryInputSchema.parse(rawInput);
  setWorkflowPhase("**Phase:** probing every Scout Activity queue");
  const expectedQueues = scoutTaskQueues(input.stage);
  const results = await Promise.all([
    realtimeActivities(input.stage).probeQueue({
      ...input,
      queueClass: "realtime",
    }),
    interactiveActivities(input.stage).probeQueue({
      ...input,
      queueClass: "interactive",
    }),
    backgroundActivities(input.stage).probeQueue({
      ...input,
      queueClass: "background",
    }),
    lakeActivities(input.stage).probeQueue({
      ...input,
      queueClass: "lake",
    }),
  ]);
  for (const result of results) {
    const parsed = ScoutQueueCanaryProbeResultSchema.parse(result);
    if (parsed.taskQueue !== expectedQueues[parsed.queueClass]) {
      throw new Error(
        `Scout ${parsed.queueClass} canary ran on ${parsed.taskQueue}, expected ${expectedQueues[parsed.queueClass]}`,
      );
    }
  }
  return results;
}
