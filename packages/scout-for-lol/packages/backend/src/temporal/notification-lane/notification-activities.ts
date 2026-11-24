import configuration from "#src/configuration.ts";
import { createLogger } from "#src/logger.ts";
import { heartbeatWhile } from "#src/temporal/activity-runtime.ts";
import type { ScoutNotificationActivities } from "#src/temporal/durable-activity-surface.ts";
import type * as NotificationDeliveryModule from "#src/temporal/notification-lane/notification-delivery.ts";
import {
  PreSendBudgetExpiredError,
  withPreSendBudget,
} from "#src/temporal/notification/pre-send-budget.ts";
import { ScoutNotificationDeliveryResultSchema } from "@scout-for-lol/temporal/activity-contracts";
import { Context } from "@temporalio/activity";

const logger = createLogger("scout-v2-notification-activities");

type LoadedNotificationDeliveryModule = typeof NotificationDeliveryModule;

let cachedNotificationDeliveryModule:
  LoadedNotificationDeliveryModule | undefined;
let notificationDeliveryModulePromise:
  Promise<LoadedNotificationDeliveryModule> | undefined;
let loadNotificationDeliveryOverride:
  (() => Promise<LoadedNotificationDeliveryModule>) | undefined;

export function preloadNotificationDelivery(): Promise<LoadedNotificationDeliveryModule> {
  if (loadNotificationDeliveryOverride !== undefined) {
    return loadNotificationDeliveryOverride();
  }
  if (cachedNotificationDeliveryModule !== undefined) {
    return Promise.resolve(cachedNotificationDeliveryModule);
  }
  notificationDeliveryModulePromise ??= (async () => {
    try {
      const loaded =
        await import("#src/temporal/notification-lane/notification-delivery.ts");
      cachedNotificationDeliveryModule = loaded;
      return loaded;
    } catch (error) {
      notificationDeliveryModulePromise = undefined;
      throw error;
    }
  })();
  return notificationDeliveryModulePromise;
}

async function warmNotificationDeliveryInBackground(): Promise<void> {
  try {
    await preloadNotificationDelivery();
  } catch (error) {
    logger.warn(
      "Eager preload of notification-delivery failed; activity call will retry under pre-send budget",
      error,
    );
  }
}

/** Test seam for cold-import budget verification; omit argument to restore. */
export function setNotificationDeliveryLoaderForTest(
  loader?: () => Promise<LoadedNotificationDeliveryModule>,
): void {
  loadNotificationDeliveryOverride = loader;
}

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
 * Roles that poll `realtime` (`activity-worker` and `combined`) eagerly warm
 * `notification-delivery.ts` when registering activities so cold module
 * evaluation never eats into `deliverNotification`'s 10s heartbeat window; any
 * uncached import at call time is additionally bounded by `withPreSendBudget`.
 */
export function createScoutNotificationActivities(): ScoutNotificationActivities {
  if (
    Bun.env.NODE_ENV !== "test" &&
    (configuration.runtimeRole === "activity-worker" ||
      configuration.runtimeRole === "combined")
  ) {
    void warmNotificationDeliveryInBackground();
  }

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
          if (Bun.env.NODE_ENV !== "test") {
            void warmNotificationDeliveryInBackground();
          }
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
    deliverNotification: async (input) => {
      const info = Context.current().info;
      logger.info("Entering deliverNotification activity", {
        intentKey: input.intentKey,
        attemptNonce: input.attemptNonce,
        stage: input.stage,
        activityAttempt: info.attempt,
        heartbeatTimeoutMs: info.heartbeatTimeoutMs,
      });
      return await heartbeatWhile(
        {
          intentKey: input.intentKey,
          attemptNonce: input.attemptNonce,
          phase: "preparing-notification-v2",
        },
        async (updateHeartbeat) => {
          let deliveryModule: LoadedNotificationDeliveryModule;
          if (
            loadNotificationDeliveryOverride === undefined &&
            cachedNotificationDeliveryModule !== undefined
          ) {
            deliveryModule = cachedNotificationDeliveryModule;
          } else {
            try {
              deliveryModule = await withPreSendBudget(
                input.intentKey,
                async () => await preloadNotificationDelivery(),
              );
            } catch (error) {
              if (error instanceof PreSendBudgetExpiredError) {
                logger.error(error.message, {
                  intentKey: input.intentKey,
                  attemptNonce: input.attemptNonce,
                });
              } else {
                logger.error(
                  `Loading notification delivery module for ${input.intentKey} failed before any send`,
                  error,
                );
              }
              return ScoutNotificationDeliveryResultSchema.parse({
                outcome: "failed",
                failure: {
                  classification: "retryable",
                  reason: "service-unavailable",
                },
              });
            }
          }
          return await deliveryModule.deliverNotification(input, {
            onBeforeSend: () => {
              updateHeartbeat({
                intentKey: input.intentKey,
                attemptNonce: input.attemptNonce,
                phase: "sending-to-discord-v2",
              });
            },
          });
        },
      );
    },
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
