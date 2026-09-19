import type { ScoutV2NotificationActivities } from "#src/temporal/v2/durable-activity-surface.ts";
import { heartbeatWhile } from "#src/temporal/activity-runtime.ts";

/**
 * The six V2 notification Activities that run on the realtime queue, as the
 * Activity Worker sees them.
 *
 * Rendering is deliberately NOT among them. `SCOUT_V2_ACTIVITY_QUEUE_CLASSES`
 * puts `renderNotificationArtifactV2` on `background` so a Satori pass never
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
export function createScoutV2NotificationActivities(): ScoutV2NotificationActivities {
  return {
    readNotificationIntentV2: async (input) =>
      await heartbeatWhile(
        { intentKey: input.intentKey, phase: "reading-intent-v2" },
        async () => {
          const { readNotificationIntentV2 } =
            await import("#src/temporal/v2/notification-reads.ts");
          return await readNotificationIntentV2(input);
        },
      ),
    markNotificationReadyV2: async (input) =>
      await heartbeatWhile(
        { intentKey: input.intentKey, phase: "readying-intent-v2" },
        async () => {
          const { markNotificationReadyV2 } =
            await import("#src/temporal/v2/notification-transitions.ts");
          return await markNotificationReadyV2(input);
        },
      ),
    beginNotificationSendV2: async (input) =>
      await heartbeatWhile(
        { intentKey: input.intentKey, phase: "beginning-send-v2" },
        async () => {
          const { beginNotificationSendV2 } =
            await import("#src/temporal/v2/notification-transitions.ts");
          return await beginNotificationSendV2(input);
        },
      ),
    // The one Activity whose retry is itself the hazard. It runs with
    // `maximumAttempts: 1` from the Workflow side; the heartbeat here is what
    // lets a worker that dies mid-send be detected by its heartbeat timeout
    // rather than by the full start-to-close budget, which is the difference
    // between an ambiguous send resolved in seconds and one resolved in
    // minutes.
    deliverNotificationV2: async (input) =>
      await heartbeatWhile(
        { intentKey: input.intentKey, phase: "delivering-notification-v2" },
        async () => {
          const { deliverNotificationV2 } =
            await import("#src/temporal/v2/notification-delivery.ts");
          return await deliverNotificationV2(input);
        },
      ),
    recordNotificationOutcomeV2: async (input) =>
      await heartbeatWhile(
        { intentKey: input.intentKey, phase: "recording-outcome-v2" },
        async () => {
          const { recordNotificationOutcomeV2 } =
            await import("#src/temporal/v2/notification-transitions.ts");
          return await recordNotificationOutcomeV2(input);
        },
      ),
    // Runs only after the delivery outcome is durably recorded, which is the
    // whole point of it being its own Activity: a best-effort Discord edit
    // that outlives a timeout can no longer take an answered send down with
    // it.
    afterNotificationDeliveredV2: async (input) =>
      await heartbeatWhile(
        { intentKey: input.intentKey, phase: "post-delivery-follow-up-v2" },
        async () => {
          const { afterNotificationDeliveredV2 } =
            await import("#src/temporal/v2/notification/notification-follow-up.ts");
          return await afterNotificationDeliveredV2(input);
        },
      ),
  };
}
