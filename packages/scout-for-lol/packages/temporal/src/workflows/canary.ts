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
  queueProbeActivities,
  realtimeActivities,
} from "./activity-options.ts";
import {
  assertScoutQueueCanaryProbe,
  scoutQueueCanaryProbeRoutes,
  scoutTaskQueues,
} from "#src/identifiers.ts";
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
  // Probe each queue class on its reserved `-probe` sibling queue. The work
  // queues run real work under small slot budgets — `background` and `lake`
  // have one slot each — so a probe dispatched onto one waited behind whatever
  // Activity held the slot, and the release gate timed out on load rather than
  // on the candidate (AI-544). The sibling worker shares the work queue's
  // process and Activity code but owns its slot, and its probe attests that
  // the work-queue worker beside it is running.
  const results = patched("scout-queue-canary-reserved-probe-slots")
    ? await probeReservedQueues(input)
    : await probeWorkQueues(input);
  return results.map((result) => ({
    ...result,
    backgroundJobKinds:
      input.backgroundJobKinds === undefined
        ? undefined
        : backgroundJobKind.options,
  }));
}

async function probeReservedQueues(
  input: ScoutQueueCanaryInput,
): Promise<ScoutQueueCanaryProbeResult[]> {
  const routes = scoutQueueCanaryProbeRoutes(input.stage, {
    includeGateway: input.includeGateway === true,
    reservedProbeSlots: true,
  });
  const results = await Promise.all(
    routes.map((route) =>
      queueProbeActivities(route.dispatchTaskQueue).probeQueue({
        ...input,
        queueClass: route.queueClass,
      }),
    ),
  );
  for (const [index, route] of routes.entries()) {
    assertScoutQueueCanaryProbe(
      route,
      ScoutQueueCanaryProbeResultSchema.parse(results[index]),
    );
  }
  return results;
}

/** The pre-patch canary, retained for replay: every probe on its work queue. */
async function probeWorkQueues(
  input: ScoutQueueCanaryInput,
): Promise<ScoutQueueCanaryProbeResult[]> {
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
  return results;
}
import { patched, proxyActivities } from "@temporalio/workflow";
import type { ScoutTemporalActivities } from "#src/activities.ts";
