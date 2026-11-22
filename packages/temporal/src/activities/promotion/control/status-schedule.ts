import { msNumberToTs, requiredTsToMs } from "@temporalio/common/time";
import { createTemporalReadClient } from "#client";
import { parseTemporalNamespace } from "#shared/infra/temporal-namespace.ts";
import { promotionConfig } from "#config/promotion.ts";
import {
  promotionDispatchAt,
  type PromotionState,
} from "#shared/promotion/model.ts";
import {
  promotionManifest,
  promotionTarget,
} from "#activities/promotion/manifest.ts";
import type { PromotionPlanningObservation } from "./status-timing.ts";

const SCHEDULE_ID = "the-storm-promotion-dispatch";
const DAY_MS = 86_400_000;

/** One native forecast covers all sources, including cooldowns beyond describe's short preview. */
export async function readPromotionPlanningObservation(
  states: PromotionState[],
  now: number,
): Promise<PromotionPlanningObservation> {
  // Invalid present settings must fail their typed boundary, not become a false forecast.
  const config = await promotionConfig();
  for (const id of config.enabledTargets) promotionTarget(id);
  const base = {
    available: config.available,
    enabled: config.enabled,
    enabledTargets: config.enabledTargets,
  };
  if (!config.available || !config.enabled)
    return { ...base, schedule: { status: "unavailable" } };
  const namespace = parseTemporalNamespace(Bun.env["TEMPORAL_NAMESPACE"]);
  const deadline = Date.now() + 4000;
  const signal = AbortSignal.timeout(4000);
  try {
    const client = await createTemporalReadClient(namespace, {
      connectTimeout: 4000,
    });
    return await client.connection.withDeadline(deadline, () =>
      client.connection.withAbortSignal(signal, async () => {
        const description = await client.schedule
          .getHandle(SCHEDULE_ID)
          .describe();
        if (description.state.paused)
          return { ...base, schedule: { status: "paused" } };
        if (description.state.remainingActions === 0)
          return { ...base, schedule: { status: "exhausted" } };
        const latestDue = Math.max(
          now,
          ...states.flatMap((state) => {
            const target = promotionManifest.targets.find(
              (item) => item.id === state.targetId,
            );
            return target === undefined ||
              !config.enabledTargets.includes(target.id)
              ? []
              : [promotionDispatchAt(target, state)];
          }),
        );
        const end = Math.min(now + 30 * DAY_MS, latestDue + 2 * DAY_MS);
        const matching = await client.workflowService.listScheduleMatchingTimes(
          {
            namespace,
            scheduleId: SCHEDULE_ID,
            startTime: msNumberToTs(now),
            endTime: msNumberToTs(end),
          },
        );
        return {
          ...base,
          schedule: {
            status: "active",
            times: matching.startTime
              .slice(0, description.state.remainingActions)
              .map((time) =>
                new Date(
                  requiredTsToMs(time, "schedule start time"),
                ).toISOString(),
              ),
          },
        };
      }),
    );
  } catch {
    // This read-only UI remains useful when the native scheduler cannot be reached.
    return { ...base, schedule: { status: "unavailable" } };
  }
}
