import {
  ScoutQueueCanaryInputSchema,
  ScoutBackgroundJobInputSchema,
  ScoutActiveBackgroundJobKindSchema,
  SCOUT_BACKGROUND_JOB_KINDS_V1,
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
import { z } from "zod";

export async function scoutQueueCanaryWorkflow(
  rawInput: ScoutQueueCanaryInput,
): Promise<ScoutQueueCanaryProbeResult[]> {
  const input = ScoutQueueCanaryInputSchema.parse(rawInput);
  const backgroundJobKind = patched("scout-queue-canary-background-kinds-v3")
    ? ScoutActiveBackgroundJobKindSchema
    : patched("scout-queue-canary-background-kinds-v2")
      ? ScoutBackgroundJobInputSchema.shape.kind
      : z.enum(SCOUT_BACKGROUND_JOB_KINDS_V1);
  for (const kind of input.backgroundJobKinds ?? []) {
    backgroundJobKind.parse(kind);
  }
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
    ...(input.includeGateway === true
      ? [
          proxyActivities<Pick<ScoutTemporalActivities, "probeQueue">>({
            taskQueue: expectedQueues.gateway,
            startToCloseTimeout: "10 seconds",
            scheduleToCloseTimeout: "1 minute",
            retry: { maximumAttempts: 3 },
          }).probeQueue({ ...input, queueClass: "gateway" }),
        ]
      : []),
  ]);
  for (const result of results) {
    const parsed = ScoutQueueCanaryProbeResultSchema.parse(result);
    if (parsed.taskQueue !== expectedQueues[parsed.queueClass]) {
      throw new Error(
        `Scout ${parsed.queueClass} canary ran on ${parsed.taskQueue}, expected ${expectedQueues[parsed.queueClass]}`,
      );
    }
  }
  return results.map((result) => ({
    ...result,
    backgroundJobKinds:
      input.backgroundJobKinds === undefined
        ? undefined
        : backgroundJobKind.options,
  }));
}
import { patched, proxyActivities } from "@temporalio/workflow";
import type { ScoutTemporalActivities } from "#src/activities.ts";
