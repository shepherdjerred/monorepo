/**
 * Deterministic Nginx Smooth Weighted Round-Robin selection across registered
 * review providers, with author-policy filtering, per-PR exclusions, and
 * temporary provider cooldowns.
 */

import { reviewGateSkipReasonForAuthor } from "./gate.ts";
import {
  PROVIDERS,
  ProviderIdSchema,
  type ProviderId,
} from "./providers/registry.ts";
import type { PullRequestAuthor } from "./types.ts";

export type ProviderWeights = Partial<Record<ProviderId, number>>;

export type SmoothWeightedState = {
  readonly currentWeights: Partial<Record<ProviderId, number>>;
  readonly cooldownUntilMs: Partial<Record<ProviderId, number>>;
};

export type WeightedSelectionOutcome =
  | { readonly kind: "assigned"; readonly providerId: ProviderId }
  | {
      readonly kind: "exhausted";
      readonly reason:
        "all-blocked" | "all-skipped" | "no-configured-providers";
    };

export const EMPTY_SMOOTH_WEIGHTED_STATE: SmoothWeightedState = {
  currentWeights: {},
  cooldownUntilMs: {},
};

function pruneExpiredCooldowns(
  cooldownUntilMs: Partial<Record<ProviderId, number>>,
  nowMs: number,
): Partial<Record<ProviderId, number>> {
  const active: Partial<Record<ProviderId, number>> = {};
  for (const id of ProviderIdSchema.options) {
    const until = cooldownUntilMs[id];
    if (until !== undefined && Number.isFinite(until) && until > nowMs) {
      active[id] = until;
    }
  }
  return active;
}

function configuredEntries(
  weights: ProviderWeights,
): { id: ProviderId; weight: number }[] {
  const entries: { id: ProviderId; weight: number }[] = [];
  for (const id of ProviderIdSchema.options) {
    const weight = weights[id];
    if (weight !== undefined && Number.isFinite(weight) && weight > 0) {
      entries.push({ id, weight });
    }
  }
  return entries;
}

function runSmoothWeightedStep(
  eligible: readonly { id: ProviderId; weight: number }[],
  currentWeights: Partial<Record<ProviderId, number>>,
): { chosen: ProviderId; nextCurrent: Partial<Record<ProviderId, number>> } {
  const nextCurrent: Partial<Record<ProviderId, number>> = {
    ...currentWeights,
  };
  let totalWeight = 0;
  let chosen: ProviderId | null = null;
  let bestWeight = Number.NEGATIVE_INFINITY;

  for (const { id, weight } of eligible) {
    const updated = (nextCurrent[id] ?? 0) + weight;
    nextCurrent[id] = updated;
    totalWeight += weight;
    if (chosen === null || updated > bestWeight) {
      chosen = id;
      bestWeight = updated;
    }
  }

  if (chosen === null) {
    throw new Error("runSmoothWeightedStep requires at least one provider");
  }
  nextCurrent[chosen] = bestWeight - totalWeight;
  return { chosen, nextCurrent };
}

/**
 * Select the next review provider using Nginx Smooth Weighted Round-Robin over
 * the active eligible set while preserving `currentWeights` for temporarily
 * skipped or cooled-down providers.
 */
export function selectNextWeightedProvider(input: {
  readonly state: SmoothWeightedState;
  readonly weights: ProviderWeights;
  readonly author: PullRequestAuthor;
  readonly excludeProviders?: readonly ProviderId[] | undefined;
  readonly nowMs: number;
}): {
  readonly selection: WeightedSelectionOutcome;
  readonly nextState: SmoothWeightedState;
} {
  const activeCooldowns = pruneExpiredCooldowns(
    input.state.cooldownUntilMs,
    input.nowMs,
  );
  const unchangedState: SmoothWeightedState = {
    currentWeights: { ...input.state.currentWeights },
    cooldownUntilMs: activeCooldowns,
  };

  const configured = configuredEntries(input.weights);
  if (configured.length === 0) {
    return {
      selection: { kind: "exhausted", reason: "no-configured-providers" },
      nextState: unchangedState,
    };
  }

  const authorCompatible = configured.filter(
    ({ id }) =>
      reviewGateSkipReasonForAuthor({
        author: input.author,
        provider: PROVIDERS[id],
      }) === null,
  );
  if (authorCompatible.length === 0) {
    return {
      selection: { kind: "exhausted", reason: "all-skipped" },
      nextState: unchangedState,
    };
  }

  const excluded = new Set<ProviderId>(input.excludeProviders);
  const eligible = authorCompatible.filter(
    ({ id }) => !excluded.has(id) && activeCooldowns[id] === undefined,
  );
  if (eligible.length === 0) {
    return {
      selection: { kind: "exhausted", reason: "all-blocked" },
      nextState: unchangedState,
    };
  }

  const { chosen, nextCurrent } = runSmoothWeightedStep(
    eligible,
    input.state.currentWeights,
  );
  return {
    selection: { kind: "assigned", providerId: chosen },
    nextState: {
      currentWeights: nextCurrent,
      cooldownUntilMs: activeCooldowns,
    },
  };
}

/**
 * Record or extend a provider's cooldown window without disturbing earlier
 * smooth-weighted fairness counters.
 */
export function applyProviderCooldown(
  state: SmoothWeightedState,
  providerId: ProviderId,
  cooldownMs: number,
  nowMs: number,
): SmoothWeightedState {
  const activeCooldowns = pruneExpiredCooldowns(state.cooldownUntilMs, nowMs);
  if (!Number.isFinite(cooldownMs) || cooldownMs <= 0) {
    return {
      currentWeights: { ...state.currentWeights },
      cooldownUntilMs: activeCooldowns,
    };
  }
  const existingUntil = activeCooldowns[providerId] ?? 0;
  return {
    currentWeights: { ...state.currentWeights },
    cooldownUntilMs: {
      ...activeCooldowns,
      [providerId]: Math.max(existingUntil, nowMs + cooldownMs),
    },
  };
}
