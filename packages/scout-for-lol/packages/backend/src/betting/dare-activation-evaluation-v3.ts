import {
  DareActivationSnapshotV3Schema,
  rankToLeaguePoints,
  type DareContractV3,
  type DareActivationSnapshotV3,
  type DareActivationV3,
  type DareSqlV3Evidence,
  type Rank,
} from "@scout-for-lol/data";

export function improvementBaselineSnapshotV3(input: {
  activation: Extract<DareActivationV3, { kind: "improvement" }>;
  evidence: DareSqlV3Evidence;
  now: Date;
}): DareActivationSnapshotV3 {
  if (input.evidence.coverage === "missing_timeline") {
    throw new Error("Required baseline timeline coverage is incomplete.");
  }
  const available = input.evidence.results
    .filter((result) => result.gameSet === input.activation.gameSet)
    .flatMap((result) => {
      const value = result.projections[input.activation.projection];
      return value === null || value === undefined ? [] : [{ result, value }];
    })
    .toSorted((left, right) => {
      const time = left.result.gameEndAt.localeCompare(right.result.gameEndAt);
      return time === 0
        ? left.result.matchId.localeCompare(right.result.matchId)
        : time;
    });
  const selected =
    input.activation.window.kind === "last_games"
      ? available.slice(-input.activation.window.count)
      : available;
  if (
    selected.length === 0 ||
    (input.activation.window.kind === "last_games" &&
      selected.length !== input.activation.window.count)
  ) {
    throw new Error(
      "The requested baseline window does not have enough complete samples.",
    );
  }
  const first = selected[0];
  const last = selected.at(-1);
  if (first === undefined || last === undefined) {
    throw new Error("Baseline selection unexpectedly became empty.");
  }
  const baselineValue = aggregate(
    selected.map((entry) => entry.value),
    input.activation.aggregation,
  );
  if (baselineValue === null) throw new Error("Baseline selection is empty.");
  return DareActivationSnapshotV3Schema.parse({
    version: 1,
    activatedAt: input.now.toISOString(),
    targets: [
      {
        kind: "improvement",
        targetKey: input.activation.targetKey,
        baselineValue,
        aggregation: input.activation.aggregation,
        direction: input.activation.direction,
        sampleCount: selected.length,
        dateSpan: {
          start: first.result.gameEndAt,
          end: last.result.gameEndAt,
        },
        sourceMatchIds: selected.map((entry) => entry.result.matchId),
      },
    ],
  });
}

function aggregate(
  values: number[],
  kind: "average" | "maximum" | "minimum",
): number | null {
  if (values.length === 0) return null;
  if (kind === "maximum") return Math.max(...values);
  if (kind === "minimum") return Math.min(...values);
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function improvementTarget(
  baseline: number,
  direction: "higher" | "lower",
  goal:
    | { kind: "personal_best" }
    | { kind: "absolute"; delta: number }
    | { kind: "percentage"; percent: number },
): number {
  if (goal.kind === "personal_best") return baseline;
  const delta =
    goal.kind === "absolute"
      ? goal.delta
      : Math.abs(baseline) * (goal.percent / 100);
  return direction === "higher" ? baseline + delta : baseline - delta;
}

function exceeds(
  value: number,
  target: number,
  direction: "higher" | "lower",
  strict: boolean,
): boolean {
  return direction === "higher"
    ? strict
      ? value > target
      : value >= target
    : strict
      ? value < target
      : value <= target;
}

export function evaluateImprovementEvidenceV3(
  contract: DareContractV3,
  evidence: DareSqlV3Evidence,
): DareSqlV3Evidence {
  if (contract.activation.kind !== "improvement") return evidence;
  const activation = contract.activation;
  const snapshot = contract.activationSnapshot?.targets.find(
    (target) =>
      target.kind === "improvement" &&
      target.targetKey === activation.targetKey,
  );
  if (snapshot?.kind !== "improvement") {
    throw new Error("Improvement Dare is missing its frozen baseline.");
  }
  const attempts = evidence.results.flatMap((result) => {
    if (result.gameSet !== activation.gameSet) return [];
    const value = result.projections[activation.projection];
    return value === undefined || value === null
      ? []
      : [{ value, matchId: result.matchId }];
  });
  const values = attempts.map((attempt) => attempt.value);
  const currentValue = aggregate(values, activation.aggregation);
  const bestAttempt =
    values.length === 0
      ? null
      : activation.direction === "higher"
        ? Math.max(...values)
        : Math.min(...values);
  const targetValue = improvementTarget(
    snapshot.baselineValue,
    activation.direction,
    activation.goal,
  );
  const measured =
    activation.goal.kind === "personal_best" ? bestAttempt : currentValue;
  const goalMet =
    measured !== null &&
    exceeds(
      measured,
      targetValue,
      activation.direction,
      activation.goal.kind === "personal_best",
    );
  return {
    ...evidence,
    achieved: evidence.coverage === "missing_timeline" ? null : goalMet,
    targetDependencies: [activation.targetKey],
    improvement: {
      targetKey: activation.targetKey,
      baselineValue: snapshot.baselineValue,
      currentValue,
      bestAttempt,
      targetValue,
      sampleCount: attempts.length,
      sourceMatchIds: attempts.map((attempt) => attempt.matchId),
      goalMet,
    },
  };
}

export function evaluateRankEvidenceV3(
  contract: DareContractV3,
  evidence: DareSqlV3Evidence,
  currentRanks: ReadonlyMap<string, Rank>,
): DareSqlV3Evidence {
  if (contract.activation.kind !== "rank") return evidence;
  const activation = contract.activation;
  const rows = contract.targets.map((target) => {
    const snapshot = contract.activationSnapshot?.targets.find(
      (candidate) =>
        candidate.kind === "rank" && candidate.targetKey === target.key,
    );
    if (snapshot?.kind !== "rank") {
      throw new Error(`Rank Dare target ${target.key} has no frozen rank.`);
    }
    const current = currentRanks.get(target.key);
    if (current === undefined) {
      throw new Error(`Rank Dare target ${target.key} has no current rank.`);
    }
    const currentLp = rankToLeaguePoints(current);
    const baselineLp = rankToLeaguePoints(snapshot.baseline);
    const goalMet =
      activation.goal.kind === "gain"
        ? currentLp - baselineLp >= activation.goal.normalizedLp
        : currentLp >=
          rankToLeaguePoints({
            tier: activation.goal.tier,
            division: activation.goal.division,
            lp: activation.goal.lp ?? 0,
            wins: 0,
            losses: 0,
          });
    return {
      targetKey: target.key,
      baseline: snapshot.baseline,
      current,
      normalizedDelta: currentLp - baselineLp,
      goalMet,
    };
  });
  return {
    ...evidence,
    achieved: rows.every((row) => row.goalMet),
    targetDependencies: rows.map((row) => row.targetKey),
    rank: { queue: activation.queue, targets: rows },
  };
}
