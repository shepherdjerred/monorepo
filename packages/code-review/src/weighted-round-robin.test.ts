import { describe, expect, test } from "vitest";
import type { ProviderId } from "./providers/registry.ts";
import {
  applyProviderCooldown,
  EMPTY_SMOOTH_WEIGHTED_STATE,
  selectNextWeightedProvider,
  type ProviderWeights,
  type SmoothWeightedState,
} from "./weighted-round-robin.ts";

const HUMAN_AUTHOR = { login: "shepherdjerred", type: "User" } as const;
const RENOVATE_BOT = { login: "renovate[bot]", type: "Bot" } as const;
const AGENT_BOT = {
  login: "justin-principal-engineer[bot]",
  type: "Bot",
} as const;

describe("selectNextWeightedProvider", () => {
  test("interleaves 6 providers smoothly in exact [3,3,2,2,1,1] ratios over 12 picks", () => {
    const weights: ProviderWeights = {
      cubic: 3,
      coderabbit: 3,
      codeant: 2,
      qodo: 2,
      greptile: 1,
      codex: 1,
    };
    let state: SmoothWeightedState = EMPTY_SMOOTH_WEIGHTED_STATE;
    const picks: ProviderId[] = [];

    for (let i = 0; i < 12; i++) {
      const result = selectNextWeightedProvider({
        state,
        weights,
        author: HUMAN_AUTHOR,
        nowMs: 1000 + i,
      });
      if (result.selection.kind !== "assigned") {
        throw new Error(`Expected assignment at step ${String(i)}`);
      }
      picks.push(result.selection.providerId);
      state = result.nextState;
    }

    const counts = new Map<ProviderId, number>();
    for (const id of picks) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    expect(counts.get("cubic")).toBe(3);
    expect(counts.get("coderabbit")).toBe(3);
    expect(counts.get("codeant")).toBe(2);
    expect(counts.get("qodo")).toBe(2);
    expect(counts.get("greptile")).toBe(1);
    expect(counts.get("codex")).toBe(1);

    // Smooth WRR never clusters 3 identical picks consecutively (in fact not even 2 here).
    for (let i = 2; i < picks.length; i++) {
      expect(picks[i] === picks[i - 1] && picks[i - 1] === picks[i - 2]).toBe(
        false,
      );
    }

    // After a full period (sum of weights = 12), all currentWeights return to 0.
    expect(
      Object.values(state.currentWeights).every((value) => value === 0),
    ).toBe(true);
  });

  test("returns no-configured-providers when weights are empty, zero, or non-positive", () => {
    for (const weights of [
      {},
      { codex: 0, cubic: -2 },
      { codex: Number.NaN, cubic: Number.POSITIVE_INFINITY },
    ] satisfies ProviderWeights[]) {
      const result = selectNextWeightedProvider({
        state: EMPTY_SMOOTH_WEIGHTED_STATE,
        weights,
        author: HUMAN_AUTHOR,
        nowMs: 1000,
      });
      expect(result.selection).toEqual({
        kind: "exhausted",
        reason: "no-configured-providers",
      });
    }
  });

  test("skips author-incompatible providers and returns all-skipped when none can review a bot PR", () => {
    // Both Qodo (policy: skip) and Codex (allowlist excludes renovate[bot]) skip Renovate.
    const allSkipped = selectNextWeightedProvider({
      state: EMPTY_SMOOTH_WEIGHTED_STATE,
      weights: { qodo: 2, codex: 1 },
      author: RENOVATE_BOT,
      nowMs: 1000,
    });
    expect(allSkipped.selection).toEqual({
      kind: "exhausted",
      reason: "all-skipped",
    });

    // Agent bot is allowlisted for Codex while Qodo still skips it.
    const codexOnly = selectNextWeightedProvider({
      state: EMPTY_SMOOTH_WEIGHTED_STATE,
      weights: { qodo: 5, codex: 1 },
      author: AGENT_BOT,
      nowMs: 1000,
    });
    expect(codexOnly.selection).toEqual({
      kind: "assigned",
      providerId: "codex",
    });
  });

  test("fails over past excludeProviders and returns all-blocked when every compatible provider is excluded", () => {
    const weights: ProviderWeights = { cubic: 3, codeant: 2 };
    const failover = selectNextWeightedProvider({
      state: EMPTY_SMOOTH_WEIGHTED_STATE,
      weights,
      author: HUMAN_AUTHOR,
      excludeProviders: ["cubic"],
      nowMs: 1000,
    });
    expect(failover.selection).toEqual({
      kind: "assigned",
      providerId: "codeant",
    });

    const exhausted = selectNextWeightedProvider({
      state: failover.nextState,
      weights,
      author: HUMAN_AUTHOR,
      excludeProviders: ["cubic", "codeant"],
      nowMs: 1001,
    });
    expect(exhausted.selection).toEqual({
      kind: "exhausted",
      reason: "all-blocked",
    });
  });

  test("skips cooled-down providers until nowMs >= cooldownUntilMs while preserving currentWeights", () => {
    const weights: ProviderWeights = { cubic: 3, coderabbit: 1 };
    const first = selectNextWeightedProvider({
      state: EMPTY_SMOOTH_WEIGHTED_STATE,
      weights,
      author: HUMAN_AUTHOR,
      nowMs: 1000,
    });
    expect(first.selection).toEqual({
      kind: "assigned",
      providerId: "cubic",
    });
    const cubicSavedWeight = first.nextState.currentWeights.cubic;

    // Put cubic on cooldown for 60s (until 61_000).
    const cooled = applyProviderCooldown(
      first.nextState,
      "cubic",
      60_000,
      1000,
    );
    expect(cooled.cooldownUntilMs.cubic).toBe(61_000);

    // Extending with a shorter window keeps the longer deadline.
    const keptLonger = applyProviderCooldown(cooled, "cubic", 5000, 2000);
    expect(keptLonger.cooldownUntilMs.cubic).toBe(61_000);

    // Non-positive cooldown leaves existing active cooldowns intact.
    const noOpCooldown = applyProviderCooldown(
      keptLonger,
      "coderabbit",
      0,
      2000,
    );
    expect(noOpCooldown.cooldownUntilMs).toEqual({ cubic: 61_000 });

    // Before expiry (60_999): cubic is skipped and its currentWeight is preserved.
    const duringCooldown = selectNextWeightedProvider({
      state: keptLonger,
      weights,
      author: HUMAN_AUTHOR,
      nowMs: 60_999,
    });
    expect(duringCooldown.selection).toEqual({
      kind: "assigned",
      providerId: "coderabbit",
    });
    expect(duringCooldown.nextState.currentWeights.cubic).toBe(
      cubicSavedWeight,
    );

    // If coderabbit is also excluded while cubic is still cooling down -> all-blocked.
    const bothUnavailable = selectNextWeightedProvider({
      state: duringCooldown.nextState,
      weights,
      author: HUMAN_AUTHOR,
      excludeProviders: ["coderabbit"],
      nowMs: 60_999,
    });
    expect(bothUnavailable.selection).toEqual({
      kind: "exhausted",
      reason: "all-blocked",
    });

    // At exact expiry (nowMs === 61_000): cooldown is pruned and cubic rejoins
    // the active set (`coderabbit`: 1+1=2, `cubic`: -1+3=2 -> canonical tie-break
    // picks `coderabbit`, then `cubic` wins the next two picks).
    const recovered = selectNextWeightedProvider({
      state: duringCooldown.nextState,
      weights,
      author: HUMAN_AUTHOR,
      nowMs: 61_000,
    });
    expect(recovered.nextState.cooldownUntilMs.cubic).toBeUndefined();
    expect(recovered.selection).toEqual({
      kind: "assigned",
      providerId: "coderabbit",
    });

    const nextAfterRecovery = selectNextWeightedProvider({
      state: recovered.nextState,
      weights,
      author: HUMAN_AUTHOR,
      nowMs: 61_001,
    });
    expect(nextAfterRecovery.selection).toEqual({
      kind: "assigned",
      providerId: "cubic",
    });
  });
});
