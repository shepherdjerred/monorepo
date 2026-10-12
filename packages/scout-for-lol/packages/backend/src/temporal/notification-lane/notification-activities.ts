import { Context } from "@temporalio/activity";
import type { ScoutNotificationActivities } from "#src/temporal/durable-activity-surface.ts";
import { heartbeatWhile } from "#src/temporal/activity-runtime.ts";

/**
 * The six V2 notification Activities that run on the realtime queue, as the
 * Activity Worker sees them.
 *
 * Rendering is deliberately NOT among them. `SCOUT_PIPELINE_ACTIVITY_QUEUE_CLASSES`
 * puts `renderNotificationArtifact` on `background` so a Satori pass never
 * sits in front of a live match, and that assignment lives once, beside the ID
 * builders, with a `satisfies` that makes an Activity added without a queue a
 * type error. Nothing here decides where anything runs; this file only groups
 * what the realtime worker registers.
 *
 * The implementations are DYNAMICALLY imported, matching v1's activity factory
 * and the V2 match core's. Building the activity groups happens during startup
 * for every role that polls a queue, and a static import chain would pull the
 * Discord client, the report renderer and Prisma into a process that may never
 * deliver a notification.
 */
export function createScoutNotificationActivities(): ScoutNotificationActivities {
  return {
    readNotificationIntent: async (input) =>
      await heartbeatWhile(
        { intentKey: input.intentKey, phase: "reading-intent-v2" },
        async () => {
          const { readNotificationIntent } =
            await import("#src/temporal/notification-lane/notification-reads.ts");
          const execution = Context.current().info.workflowExecution;
          if (execution === undefined) {
            throw new Error(
              "Notification intent read has no Workflow execution",
            );
          }
          return await readNotificationIntent(input, execution);
        },
      ),
    markNotificationReady: async (input) =>
      await heartbeatWhile(
        { intentKey: input.intentKey, phase: "readying-intent-v2" },
        async () => {
          const { markNotificationReady } =
            await import("#src/temporal/notification-lane/notification-transitions.ts");
          return await markNotificationReady(input);
        },
      ),
    beginNotificationSend: async (input) =>
      await heartbeatWhile(
        { intentKey: input.intentKey, phase: "beginning-send-v2" },
        async () => {
          const { beginNotificationSend } =
            await import("#src/temporal/notification-lane/notification-transitions.ts");
          return await beginNotificationSend(input);
        },
      ),
    // The one Activity whose retry is itself the hazard. It runs with
    // `maximumAttempts: 1` from the Workflow side; the heartbeat here is what
    // lets a worker that dies mid-send be detected by its heartbeat timeout
    // rather than by the full start-to-close budget, which is the difference
    // between an ambiguous send resolved in seconds and one resolved in
    // minutes.
    deliverNotification: async (input) =>
      await heartbeatWhile(
        { intentKey: input.intentKey, phase: "delivering-notification-v2" },
        async () => {
          const { deliverNotification } =
            await import("#src/temporal/notification-lane/notification-delivery.ts");
          return await deliverNotification(input);
        },
      ),
    recordNotificationOutcome: async (input) =>
      await heartbeatWhile(
        { intentKey: input.intentKey, phase: "recording-outcome-v2" },
        async () => {
          const { recordNotificationOutcome } =
            await import("#src/temporal/notification-lane/notification-transitions.ts");
          return await recordNotificationOutcome(input);
        },
      ),
    // Runs only after the delivery outcome is durably recorded, which is the
    // whole point of it being its own Activity: a best-effort Discord edit
    // that outlives a timeout can no longer take an answered send down with
    // it.
    afterNotificationDelivered: async (input) =>
      await heartbeatWhile(
        { intentKey: input.intentKey, phase: "post-delivery-follow-up-v2" },
        async () => {
          const { afterNotificationDelivered } =
            await import("#src/temporal/notification/notification-follow-up.ts");
          return await afterNotificationDelivered(input);
        },
      ),
  };
}
