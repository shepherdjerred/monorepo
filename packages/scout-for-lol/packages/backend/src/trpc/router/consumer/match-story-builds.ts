import {
  reportItemCatalog,
  type ItemTier,
} from "@scout-for-lol/data/model/reports/report-query-items.ts";
import type { StoryEvent } from "#src/reports/duckdb/consumer/match-story-reads.ts";

/** A participant's purchases and skill points, in the order they happened. */

export type BuildStep = {
  itemId: number;
  timestampMs: number;
  minute: number;
  tier: ItemTier;
  /** When the item was sold, or `null` if it was kept to the end. */
  soldAtMs: number | null;
};

export type SkillKey = "Q" | "W" | "E" | "R";

/** A participant's purchases never run past this; a game buys about 30. */
export const MAX_BUILD_STEPS = 60;

const TIER_BY_ITEM = new Map<number, ItemTier>(
  reportItemCatalog().map(({ rawId, item }) => [rawId, item.tier] as const),
);

/**
 * Tiers that are not part of a build: consumables (potions, wards, elixirs)
 * and the trinket. An item the catalog does not know is kept, as `other`.
 */
const EXCLUDED_TIERS = new Set<ItemTier>(["consumable", "trinket"]);

const SKILL_BY_SLOT: ReadonlyMap<number, SkillKey> = new Map([
  [1, "Q"],
  [2, "W"],
  [3, "E"],
  [4, "R"],
]);

/** The fields of a timeline event that a build is worked out from. */
export type BuildEvent = Pick<
  StoryEvent,
  "event_type" | "event_timestamp_ms" | "item_id" | "before_id" | "after_id"
>;

type MutableStep = BuildStep & { undone: boolean };

function latestStep(
  steps: readonly MutableStep[],
  predicate: (step: MutableStep) => boolean,
): MutableStep | undefined {
  for (let index = steps.length - 1; index >= 0; index--) {
    const step = steps[index];
    if (step !== undefined && predicate(step)) return step;
  }
  return undefined;
}

function applyPurchase(steps: MutableStep[], event: BuildEvent): void {
  if (event.item_id === null) return;
  const tier = TIER_BY_ITEM.get(event.item_id) ?? "other";
  if (EXCLUDED_TIERS.has(tier)) return;
  steps.push({
    itemId: event.item_id,
    timestampMs: event.event_timestamp_ms,
    minute: Math.floor(event.event_timestamp_ms / 60_000),
    tier,
    soldAtMs: null,
    undone: false,
  });
}

function applySale(steps: readonly MutableStep[], event: BuildEvent): void {
  const step = latestStep(
    steps,
    (entry) =>
      entry.itemId === event.item_id &&
      !entry.undone &&
      entry.soldAtMs === null,
  );
  if (step !== undefined) step.soldAtMs = event.event_timestamp_ms;
}

/** An undo with a `before_id` cancels a purchase; with only an `after_id`, a sale. */
function applyUndo(steps: readonly MutableStep[], event: BuildEvent): void {
  const beforeId = event.before_id ?? 0;
  const afterId = event.after_id ?? 0;
  if (beforeId !== 0) {
    const bought = latestStep(
      steps,
      (entry) => entry.itemId === beforeId && !entry.undone,
    );
    if (bought !== undefined) bought.undone = true;
    return;
  }
  const sold = latestStep(
    steps,
    (entry) =>
      afterId !== 0 &&
      entry.itemId === afterId &&
      !entry.undone &&
      entry.soldAtMs !== null,
  );
  if (sold !== undefined) sold.soldAtMs = null;
}

/**
 * One participant's build, from their purchase, sale and undo events in
 * timeline order.
 *
 * - An undone purchase never happened: `ITEM_UNDO` with a `before_id` cancels
 *   the latest purchase of that item that is still standing.
 * - A sale marks the latest standing, unsold purchase of that item as sold;
 *   an undo with no `before_id` and an `after_id` takes the sale back.
 * - Consumables and trinkets are not listed.
 */
export function buildOrderFor(events: readonly BuildEvent[]): BuildStep[] {
  const steps: MutableStep[] = [];
  for (const event of events) {
    switch (event.event_type) {
      case "ITEM_PURCHASED":
        applyPurchase(steps, event);
        break;
      case "ITEM_SOLD":
        applySale(steps, event);
        break;
      case "ITEM_UNDO":
        applyUndo(steps, event);
        break;
      default:
        break;
    }
  }
  return steps
    .filter((step) => !step.undone)
    .slice(0, MAX_BUILD_STEPS)
    .map((step) => ({
      itemId: step.itemId,
      timestampMs: step.timestampMs,
      minute: step.minute,
      tier: step.tier,
      soldAtMs: step.soldAtMs,
    }));
}

/** The order skill points were spent in, ability keys only (no evolutions). */
export function skillOrderFor(events: readonly StoryEvent[]): SkillKey[] {
  const order: SkillKey[] = [];
  for (const event of events) {
    if (
      event.event_type !== "SKILL_LEVEL_UP" ||
      event.level_up_type !== "NORMAL" ||
      event.skill_slot === null
    ) {
      continue;
    }
    const key = SKILL_BY_SLOT.get(event.skill_slot);
    if (key === undefined) {
      throw new Error(
        `Skill level-up names unknown slot ${String(event.skill_slot)}`,
      );
    }
    order.push(key);
  }
  return order;
}
