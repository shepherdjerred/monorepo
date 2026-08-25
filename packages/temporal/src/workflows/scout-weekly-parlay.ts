import {
  continueAsNew,
  log,
  patched,
  proxyActivities,
  sleep,
  workflowInfo,
} from "@temporalio/workflow";
import { z } from "zod";
import {
  WEEKLY_PARLAY_LIFECYCLE,
  type WeeklyParlayControlAction as ScoutWeeklyParlayAction,
} from "@scout-for-lol/data/model/weekly-parlay.ts";
import type {
  ScoutWeeklyParlayActivities,
  ScoutWeeklyParlayTimeline,
} from "#activities/scout-weekly-parlay.ts";

const EMBEDDED_SCOUT_ACTIVITY_PATCH =
  "scout-weekly-parlay-embedded-activities-v1";

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

const embeddedDeliveryActivities = proxyActivities<
  Pick<ScoutWeeklyParlayActivities, "invokeScoutWeeklyParlayAction">
>({
  taskQueue: "scout-beta-background",
  startToCloseTimeout: "30 seconds",
  retry: {
    maximumAttempts: 5,
    initialInterval: "10 seconds",
    backoffCoefficient: 2,
    maximumInterval: "1 minute",
  },
});

const embeddedOpenActivities = proxyActivities<
  Pick<ScoutWeeklyParlayActivities, "invokeScoutWeeklyParlayAction">
>({
  taskQueue: "scout-beta-background",
  startToCloseTimeout: "5 minutes",
  retry: {
    maximumAttempts: 5,
    initialInterval: "10 seconds",
    backoffCoefficient: 2,
    maximumInterval: "1 minute",
  },
});

function deliveryActionActivities(
  useEmbedded: boolean,
): Pick<ScoutWeeklyParlayActivities, "invokeScoutWeeklyParlayAction"> {
  return useEmbedded ? embeddedDeliveryActivities : deliveryActivities;
}

function openActionActivities(
  useEmbedded: boolean,
): Pick<ScoutWeeklyParlayActivities, "invokeScoutWeeklyParlayAction"> {
  return useEmbedded ? embeddedOpenActivities : openActivities;
}

function lifecycleActionActivities(
  useEmbedded: boolean,
): Pick<ScoutWeeklyParlayActivities, "invokeScoutWeeklyParlayAction"> {
  return useEmbedded ? embeddedDeliveryActivities : lifecycleActivities;
}

const LIFECYCLE_RETRY_INTERVAL_MS = 5 * 60 * 1000;
const FINALIZATION_CONTINUE_AS_NEW_AFTER_MS = 15 * 60 * 1000;

const ScoutWeeklyParlayWorkflowInputSchema = z.strictObject({
  slot: z.number().int().nonnegative().default(WEEKLY_PARLAY_LIFECYCLE.slot),
  phase: z.enum(["lifecycle", "finalize"]).default("lifecycle"),
  periodKey: z.iso.date().optional(),
});
export type ScoutWeeklyParlayWorkflowInput = z.input<
  typeof ScoutWeeklyParlayWorkflowInputSchema
>;

const ScoutWeeklyParlayCatchupWorkflowInputSchema = z.strictObject({
  periodKey: z.iso.date(),
  slot: z.number().int().nonnegative().default(WEEKLY_PARLAY_LIFECYCLE.slot),
  phase: z.enum(["lifecycle", "finalize"]).default("lifecycle"),
});
export type ScoutWeeklyParlayCatchupWorkflowInput = z.input<
  typeof ScoutWeeklyParlayCatchupWorkflowInputSchema
>;

async function sleepUntil(timestamp: string): Promise<void> {
  const remaining = new Date(timestamp).getTime() - Date.now();
  if (remaining > 0) {
    await sleep(remaining);
  }
}

async function invokeDeliveryAction(
  action: ScoutWeeklyParlayAction,
  useEmbeddedActivities: boolean,
): Promise<void> {
  try {
    await (action.action === "open"
      ? openActionActivities(
          useEmbeddedActivities,
        ).invokeScoutWeeklyParlayAction(action)
      : deliveryActionActivities(
          useEmbeddedActivities,
        ).invokeScoutWeeklyParlayAction(action));
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
  useEmbeddedActivities: boolean,
): Promise<void> {
  const deadline = new Date(finalizesAt).getTime();
  while (Date.now() < deadline) {
    try {
      const result = await lifecycleActionActivities(
        useEmbeddedActivities,
      ).invokeScoutWeeklyParlayAction(action);
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
  mode: "standard" | "catch_up",
  useEmbeddedActivities: boolean,
): Promise<void> {
  const retryUntil = Date.now() + FINALIZATION_CONTINUE_AS_NEW_AFTER_MS;
  while (Date.now() < retryUntil) {
    try {
      const result = await lifecycleActionActivities(
        useEmbeddedActivities,
      ).invokeScoutWeeklyParlayAction(action);
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
  if (mode === "catch_up") {
    await continueAsNew<typeof runScoutWeeklyParlayCatchupWorkflow>({
      slot: action.slot,
      phase: "finalize",
      periodKey: action.periodKey,
    });
  } else {
    await continueAsNew<typeof runScoutWeeklyParlayWorkflow>({
      slot: action.slot,
      phase: "finalize",
      periodKey: action.periodKey,
    });
  }
}

async function runFrozenTimeline(
  timeline: ScoutWeeklyParlayTimeline,
  slot: number,
  mode: "standard" | "catch_up",
  useEmbeddedActivities: boolean,
): Promise<void> {
  const base = { periodKey: timeline.periodKey, slot };

  await sleepUntil(timeline.openAt);
  await invokeDeliveryAction(
    {
      ...base,
      action: "open",
      ...(mode === "catch_up"
        ? {
            window: {
              kind: "catch_up" as const,
              openAt: timeline.openAt,
              bettingClosesAt: timeline.startsAt,
              scoringStartsAt: timeline.startsAt,
              scoringEndsAt: timeline.finalizesAt,
            },
          }
        : {}),
    },
    useEmbeddedActivities,
  );

  if (timeline.reminderAt !== undefined) {
    await sleepUntil(timeline.reminderAt);
    await invokeDeliveryAction(
      { ...base, action: "reminder" },
      useEmbeddedActivities,
    );
  }

  await sleepUntil(timeline.startsAt);
  await reconcileStartUntilFinalization(
    { ...base, action: "start" },
    timeline.finalizesAt,
    useEmbeddedActivities,
  );

  for (const [updateIndex, updateAt] of timeline.updatesAt.entries()) {
    await sleepUntil(updateAt);
    await invokeDeliveryAction(
      {
        ...base,
        action: "progress",
        updateIndex,
      },
      useEmbeddedActivities,
    );
  }

  await sleepUntil(timeline.finalizesAt);
  await reconcileFinalization(
    { ...base, action: "finalize" },
    mode,
    useEmbeddedActivities,
  );
}

export async function runScoutWeeklyParlayWorkflow(
  rawInput: ScoutWeeklyParlayWorkflowInput = {},
): Promise<void> {
  const input = ScoutWeeklyParlayWorkflowInputSchema.parse(rawInput);
  const useEmbeddedActivities = patched(EMBEDDED_SCOUT_ACTIVITY_PATCH);
  if (input.phase === "finalize") {
    if (input.periodKey === undefined) {
      throw new Error("Finalization continuation requires periodKey.");
    }
    await reconcileFinalization(
      {
        periodKey: input.periodKey,
        slot: input.slot,
        action: "finalize",
      },
      "standard",
      useEmbeddedActivities,
    );
    return;
  }
  // Temporal records this instant when the Schedule starts the execution. It
  // remains stable even if no worker can process the first task until later.
  const scheduledStartAt = workflowInfo().startTime.toISOString();
  const timeline =
    await deliveryActivities.resolveScoutWeeklyParlayTimeline(scheduledStartAt);
  await runFrozenTimeline(
    timeline,
    input.slot,
    "standard",
    useEmbeddedActivities,
  );
}

export async function runScoutWeeklyParlayCatchupWorkflow(
  rawInput: ScoutWeeklyParlayCatchupWorkflowInput,
): Promise<void> {
  const input = ScoutWeeklyParlayCatchupWorkflowInputSchema.parse(rawInput);
  const useEmbeddedActivities = patched(EMBEDDED_SCOUT_ACTIVITY_PATCH);
  if (input.phase === "finalize") {
    await reconcileFinalization(
      {
        periodKey: input.periodKey,
        slot: input.slot,
        action: "finalize",
      },
      "catch_up",
      useEmbeddedActivities,
    );
    return;
  }
  const workflowStartAt = workflowInfo().startTime.toISOString();
  const timeline =
    await deliveryActivities.resolveScoutWeeklyParlayCatchupTimeline(
      workflowStartAt,
      input.periodKey,
    );
  await runFrozenTimeline(
    timeline,
    input.slot,
    "catch_up",
    useEmbeddedActivities,
  );
}
