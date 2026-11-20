import { promotionFailureStatuses } from "./classification.ts";
import type {
  PromotionBatch,
  PromotionHistoryEntry,
  PromotionSourceActivity,
} from "./model.ts";
import { promotionConfirmedSuccesses, promotionSuccessAt } from "./timing.ts";

export const PROMOTION_ACTIVITY_DAYS = 30;

const DAY_MS = 86_400_000;
const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Pacific calendar day, as YYYY-MM-DD, of an instant. */
export const promotionDay = (instant: string | number) =>
  dayFormat.format(typeof instant === "string" ? Date.parse(instant) : instant);

// Calendar days are stepped in UTC so a daylight-saving change cannot skip or repeat one.
const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / DAY_MS;
const shiftDay = (day: string, by: number) =>
  new Date((dayNumber(day) + by) * DAY_MS).toISOString().slice(0, 10);

const executed = (entry: PromotionHistoryEntry) =>
  !["skipped", "queued", "running"].includes(entry.status);

/**
 * Daily publishing activity for one source. Each occurrence counts once: a
 * recorded attempt is the final word on its occurrence, so a run that failed
 * and was later confirmed is a post. Skips, previews, reconciliation and
 * cleanup are not activity.
 */
export function promotionSourceActivity(input: {
  targetId: string;
  batches: PromotionBatch[];
  history: PromotionHistoryEntry[];
  now: number;
  days?: number;
}): PromotionSourceActivity {
  const count = input.days ?? PROMOTION_ACTIVITY_DAYS;
  const startDay = shiftDay(promotionDay(input.now), 1 - count);
  const first = dayNumber(startDay);
  const days = Array.from({ length: count }, () => ({
    posts: 0,
    failures: 0,
    noAction: 0,
  }));
  const add = (instant: string, kind: keyof (typeof days)[number]) => {
    const day = days[dayNumber(promotionDay(instant)) - first];
    if (day !== undefined) day[kind] += 1;
  };

  const own = input.history.filter(
    (entry) => entry.targetId === input.targetId,
  );
  const successes = promotionConfirmedSuccesses(input.targetId, own);
  for (const entry of successes) add(promotionSuccessAt(entry), "posts");

  const confirmed = new Set(successes.map((entry) => entry.occurrenceId));
  const attempted = new Set(
    own
      .filter((entry) => entry.timeBasis === "attempt")
      .map((entry) => entry.occurrenceId),
  );
  for (const entry of own) {
    if (successes.includes(entry)) continue;
    if (entry.occurrenceId !== null && confirmed.has(entry.occurrenceId))
      continue;
    const counted =
      entry.timeBasis === "attempt" ||
      (entry.timeBasis === "execution" &&
        entry.mode === "run" &&
        executed(entry) &&
        (entry.occurrenceId === null || !attempted.has(entry.occurrenceId)));
    if (!counted) continue;
    add(
      entry.at,
      promotionFailureStatuses.includes(entry.status) ? "failures" : "noAction",
    );
  }

  const oldest = input.batches
    .map((batch) => batch.startedAt)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  return {
    startDay,
    runDetailFrom: oldest === undefined ? null : promotionDay(oldest),
    days,
  };
}
