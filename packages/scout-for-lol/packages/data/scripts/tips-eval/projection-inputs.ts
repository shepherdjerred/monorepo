import { getPricing } from "@shepherdjerred/llm-models";
import { currentLanePriors } from "#src/lane-priors/current.ts";
import type { PriceMultipliers } from "#src/tips/eval/filter.ts";
import type { PlanShape } from "#src/tips/eval/summary.ts";
import { planTips } from "#src/tips/plan.ts";
import { lanePriorTipPlanSource } from "#src/tips/plan-sources.ts";

export const PATCH_CHAMPIONS = 12;

export function multipliersFor(
  model: string,
  ttl: "5m" | "1h",
): PriceMultipliers {
  const pricing = getPricing(model);
  if (pricing?.modality !== "text") {
    throw new Error(`no text pricing for ${model}`);
  }
  const write = pricing.cacheWriteByTtl?.[ttl] ?? pricing.cacheWrite;
  const read = pricing.cacheRead;
  const batch = pricing.serviceTierMultipliers?.batch;
  if (write === undefined || read === undefined || batch === undefined) {
    throw new Error(`${model} has no cache or batch price on file`);
  }
  return {
    batch,
    cacheRead: read / pricing.input,
    cacheWrite: write / pricing.input,
  };
}

export function planFigures(): {
  shape: PlanShape;
  reuse: { units: number; anchors: number };
} {
  const plan = planTips(lanePriorTipPlanSource(currentLanePriors));
  const degree = new Map<number, number>();
  for (const unit of plan.units) {
    for (const id of unit.championIds) {
      degree.set(id, (degree.get(id) ?? 0) + 1);
    }
  }
  // Each unit's shared block is its champion that leads the most units.
  const anchors = new Set<number>();
  for (const unit of plan.units) {
    const [first, second] = unit.championIds;
    anchors.add(
      (degree.get(first) ?? 0) >= (degree.get(second) ?? 0) ? first : second,
    );
  }
  for (const entry of plan.championLanes) {
    anchors.add(entry.championId);
  }
  const champions = new Set([
    ...plan.units.flatMap((unit) => unit.championIds),
    ...plan.championLanes.map((entry) => entry.championId),
  ]);
  return {
    shape: {
      matchupUnits: plan.counts.units,
      generalSets: plan.counts.championLanes,
      unitsPerChampion: (2 * plan.counts.units) / champions.size,
      generalPerChampion: plan.counts.championLanes / champions.size,
      patchChampions: PATCH_CHAMPIONS,
    },
    reuse: {
      units: plan.counts.units + plan.counts.championLanes,
      anchors: anchors.size,
    },
  };
}
