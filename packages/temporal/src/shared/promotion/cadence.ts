import type { PromotionState, PromotionTarget } from "#shared/promotion.ts";
import { promotionDispatchAt } from "#shared/promotion.ts";

export const PROMOTION_TIMEZONE = "America/Los_Angeles";
export const PROMOTION_SWEEP_HOURS = [8, 12, 16, 20] as const;

/** Preferred times add constraints; they never shorten the source's actual cooldown. */
export function promotionWindow(
  target: PromotionTarget,
  state: PromotionState,
  now: number,
) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PROMOTION_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => {
    const value = parts.find((p) => p.type === type)?.value;
    if (value === undefined) throw new Error(`Missing date part: ${type}`);
    return value;
  };
  const day = `${part("year")}-${part("month")}-${part("day")}`;
  const hour = Number(part("hour"));
  const daily = target.minimumIntervalSeconds >= 86_400;
  const inWindow = daily ? hour >= 16 && hour < 20 : hour >= 8 && hour < 22;
  const dateFormat = new Intl.DateTimeFormat("en-CA", {
    timeZone: PROMOTION_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const attemptsToday = state.attempts.filter(
    (a) =>
      a.status !== "no-action" &&
      dateFormat.format(Date.parse(a.attemptedAt)) === day,
  ).length;
  const allowed = inWindow && attemptsToday < (daily ? 1 : 4);
  const dueAt = promotionDispatchAt(target, state);
  const minute = Number(
    new Intl.DateTimeFormat("en", {
      timeZone: PROMOTION_TIMEZONE,
      minute: "numeric",
    }).format(now),
  );
  const windowEnd =
    now + (20 - hour) * 3_600_000 - minute * 60_000 - (now % 60_000);
  return {
    day,
    inWindow,
    dueAt,
    allowed,
    canDispatch: allowed && (daily ? dueAt < windowEnd : dueAt <= now),
  };
}
