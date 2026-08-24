import {
  continueAsNew,
  log,
  proxyActivities,
  sleep,
  workflowInfo,
} from "@temporalio/workflow";
import { z } from "zod";
import type {
  ScoutWeeklyParlayAction,
  ScoutWeeklyParlayActivities,
} from "#activities/scout-weekly-parlay.ts";

const deliveryActivities = proxyActivities<ScoutWeeklyParlayActivities>({
  startToCloseTimeout: "30 seconds",
  retry: {
    maximumAttempts: 5,
    initialInterval: "10 seconds",
    backoffCoefficient: 2,
    maximumInterval: "1 minute",
  },
});

const openActivities = proxyActivities<ScoutWeeklyParlayActivities>({
  startToCloseTimeout: "5 minutes",
  retry: {
    maximumAttempts: 5,
    initialInterval: "10 seconds",
    backoffCoefficient: 2,
    maximumInterval: "1 minute",
  },
});

const lifecycleActivities = proxyActivities<ScoutWeeklyParlayActivities>({
  startToCloseTimeout: "30 seconds",
  retry: {
    maximumAttempts: 5,
    initialInterval: "10 seconds",
    backoffCoefficient: 2,
    maximumInterval: "1 minute",
  },
});

const LIFECYCLE_RETRY_INTERVAL_MS = 5 * 60 * 1000;
const FINALIZATION_CONTINUE_AS_NEW_AFTER_MS = 15 * 60 * 1000;

const ScoutWeeklyParlayWorkflowInputSchema = z.strictObject({
  slot: z.number().int().nonnegative().default(0),
  phase: z.enum(["lifecycle", "finalize"]).default("lifecycle"),
  periodKey: z.iso.date().optional(),
});
export type ScoutWeeklyParlayWorkflowInput = z.input<
  typeof ScoutWeeklyParlayWorkflowInputSchema
>;

async function sleepUntil(timestamp: string): Promise<void> {
  const remaining = new Date(timestamp).getTime() - Date.now();
  if (remaining > 0) {
    await sleep(remaining);
  }
}

async function invokeDeliveryAction(
  action: ScoutWeeklyParlayAction,
): Promise<void> {
  try {
    await (action.action === "open"
      ? openActivities.invokeScoutWeeklyParlayAction(action)
      : deliveryActivities.invokeScoutWeeklyParlayAction(action));
  } catch (error) {
    log.warn(
      "Weekly Scout parlay delivery action exhausted retries; continuing lifecycle",
      {
        periodKey: action.periodKey,
        slot: action.slot,
        action: action.action,
        ...(action.updateIndex === undefined
          ? {}
          : { updateIndex: action.updateIndex }),
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

async function reconcileStartUntilFinalization(
  action: ScoutWeeklyParlayAction,
  finalizesAt: string,
): Promise<void> {
  const deadline = new Date(finalizesAt).getTime();
  while (Date.now() < deadline) {
    try {
      const result =
        await lifecycleActivities.invokeScoutWeeklyParlayAction(action);
      if (result.status === "reconciled" || result.detail === "no_market") {
        return;
      }
      log.warn("Weekly Scout parlay start was not reconciled; retrying", {
        periodKey: action.periodKey,
        slot: action.slot,
        detail: result.detail,
      });
    } catch (error) {
      log.warn(
        "Weekly Scout parlay start exhausted activity retries; retrying",
        {
          periodKey: action.periodKey,
          slot: action.slot,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
    const remaining = deadline - Date.now();
    if (remaining > 0) {
      await sleep(Math.min(LIFECYCLE_RETRY_INTERVAL_MS, remaining));
    }
  }
  log.error(
    "Weekly Scout parlay start did not reconcile before finalization cutoff",
    {
      periodKey: action.periodKey,
      slot: action.slot,
    },
  );
}

async function reconcileFinalization(
  action: ScoutWeeklyParlayAction,
): Promise<void> {
  const retryUntil = Date.now() + FINALIZATION_CONTINUE_AS_NEW_AFTER_MS;
  while (Date.now() < retryUntil) {
    try {
      const result =
        await lifecycleActivities.invokeScoutWeeklyParlayAction(action);
      if (result.status === "reconciled" || result.detail === "no_market") {
        return;
      } else {
        log.warn("Weekly Scout parlay finalization was incomplete; retrying", {
          periodKey: action.periodKey,
          slot: action.slot,
          detail: result.detail,
        });
      }
    } catch (error) {
      log.warn(
        "Weekly Scout parlay finalization exhausted activity retries; retrying",
        {
          periodKey: action.periodKey,
          slot: action.slot,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
    const remaining = retryUntil - Date.now();
    if (remaining > 0) {
      await sleep(Math.min(LIFECYCLE_RETRY_INTERVAL_MS, remaining));
    }
  }
  log.warn("Weekly Scout parlay finalization slice ended; continuing as new", {
    periodKey: action.periodKey,
    slot: action.slot,
  });
  await continueAsNew<typeof runScoutWeeklyParlayWorkflow>({
    slot: action.slot,
    phase: "finalize",
    periodKey: action.periodKey,
  });
}

export async function runScoutWeeklyParlayWorkflow(
  rawInput: ScoutWeeklyParlayWorkflowInput = {},
): Promise<void> {
  const input = ScoutWeeklyParlayWorkflowInputSchema.parse(rawInput);
  if (input.phase === "finalize") {
    if (input.periodKey === undefined) {
      throw new Error("Finalization continuation requires periodKey.");
    }
    await reconcileFinalization({
      periodKey: input.periodKey,
      slot: input.slot,
      action: "finalize",
    });
    return;
  }
  // Temporal records this instant when the Schedule starts the execution. It
  // remains stable even if no worker can process the first task until later.
  const scheduledStartAt = workflowInfo().startTime.toISOString();
  const timeline =
    await deliveryActivities.resolveScoutWeeklyParlayTimeline(scheduledStartAt);
  const base = { periodKey: timeline.periodKey, slot: input.slot };

  await sleepUntil(timeline.openAt);
  await invokeDeliveryAction({
    ...base,
    action: "open",
  });

  await sleepUntil(timeline.reminderAt);
  await invokeDeliveryAction({
    ...base,
    action: "reminder",
  });

  await sleepUntil(timeline.startsAt);
  await reconcileStartUntilFinalization(
    {
      ...base,
      action: "start",
    },
    timeline.finalizesAt,
  );

  for (const [updateIndex, updateAt] of timeline.updatesAt.entries()) {
    await sleepUntil(updateAt);
    await invokeDeliveryAction({
      ...base,
      action: "progress",
      updateIndex,
    });
  }

  await sleepUntil(timeline.finalizesAt);
  await reconcileFinalization({
    ...base,
    action: "finalize",
  });
}
