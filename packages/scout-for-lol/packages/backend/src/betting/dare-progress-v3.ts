import {
  DareProgressSchema,
  DareSqlV3EvidenceSchema,
  rankToString,
  type DareProgress,
  type DareSqlV3Compilation,
} from "@scout-for-lol/data";
import { z } from "zod";

const SourceReferenceSchema = z.array(
  z.union([
    z.string().min(1),
    z.object({ matchId: z.string().min(1) }).transform((row) => row.matchId),
  ]),
);

type StoredV3Evidence = {
  matchId: string;
  gameEndAt: Date;
  evaluationOutput: string;
  sourceReferences: string;
  coverageState: string;
};

function parseEvidence(row: StoredV3Evidence) {
  return DareSqlV3EvidenceSchema.parse(JSON.parse(row.evaluationOutput));
}

function distinctMatchCount(matchIds: readonly string[]): number {
  return new Set(matchIds).size;
}

function currentStreak(rows: readonly { matched: boolean | null }[]): number {
  let length = 0;
  for (const row of rows.toReversed()) {
    if (row.matched !== true) break;
    length += 1;
  }
  return length;
}

function activationConditions(
  compilation: DareSqlV3Compilation,
  latest: ReturnType<typeof parseEvidence> | null,
): DareProgress["conditions"] {
  if (compilation.activation.kind === "rank") {
    const activation = compilation.activation;
    return (latest?.rank?.targets ?? []).map((target) => ({
      key: `rank-${target.targetKey}`,
      kind: "rank_progress",
      label: `${target.targetKey} ${activation.queue} rank`,
      targetKeys: [target.targetKey],
      gameSet: null,
      operator: activation.goal.kind === "gain" ? "gain" : "reach",
      current: rankToString(target.current),
      target:
        activation.goal.kind === "gain"
          ? `${activation.goal.normalizedLp.toString()} normalized LP`
          : `${activation.goal.tier} ${activation.goal.division.toString()} ${activation.goal.lp?.toString() ?? "0"} LP`,
      remaining:
        activation.goal.kind === "gain"
          ? Math.max(0, activation.goal.normalizedLp - target.normalizedDelta)
          : null,
      matchedGames: 0,
      eligibleGames: 0,
      unknownGames: 0,
      value: target.goalMet,
    }));
  }
  const improvement = latest?.improvement;
  if (
    improvement === null ||
    improvement === undefined ||
    compilation.activation.kind !== "improvement"
  ) {
    return [];
  }
  return [
    {
      key: "improvement",
      kind: "personal_improvement",
      label: `${compilation.activation.aggregation} ${compilation.activation.projection}`,
      targetKeys: [improvement.targetKey],
      gameSet: compilation.activation.gameSet,
      operator: compilation.activation.direction,
      current: improvement.currentValue,
      target: improvement.targetValue,
      remaining:
        improvement.currentValue === null
          ? null
          : Math.max(
              0,
              Math.abs(improvement.targetValue - improvement.currentValue),
            ),
      matchedGames: improvement.sampleCount,
      eligibleGames: improvement.sampleCount,
      unknownGames: 0,
      value: improvement.goalMet,
    },
  ];
}

type ParsedEvidence = ReturnType<typeof parseEvidence>;
type ProgressCondition = DareProgress["conditions"][number];

function orderedEvidence(
  evidence: readonly StoredV3Evidence[],
): StoredV3Evidence[] {
  return evidence.toSorted((left, right) => {
    const time = left.gameEndAt.getTime() - right.gameEndAt.getTime();
    return time === 0 ? left.matchId.localeCompare(right.matchId) : time;
  });
}

function sqlProgressConditions(
  compilation: DareSqlV3Compilation,
  latest: ParsedEvidence | null,
): ProgressCondition[] {
  return compilation.resultStructure.gameSets.map((gameSet, index) => {
    const rows =
      latest?.results.filter((result) => result.gameSet === gameSet.name) ?? [];
    const matches = rows.filter((result) => result.matched === true);
    const raceLane =
      compilation.competition.kind === "race"
        ? compilation.competition.lanes.find(
            (lane) => lane.gameSet === gameSet.name,
          )
        : undefined;
    const earliest = matches.map((result) => result.gameEndAt).toSorted()[0];
    const isStreak = gameSet.name.toLocaleLowerCase().includes("streak");
    return {
      key: index.toString(),
      kind:
        raceLane === undefined
          ? isStreak
            ? "streak"
            : "sql_result_set"
          : "race_lane",
      label:
        raceLane === undefined
          ? `${gameSet.name} SQL result`
          : `${raceLane.targetKey} race lane`,
      targetKeys: gameSet.targetDependencies,
      gameSet: gameSet.name,
      operator: null,
      current:
        raceLane === undefined
          ? isStreak
            ? currentStreak(rows)
            : distinctMatchCount(matches.map((result) => result.matchId))
          : (earliest ?? null),
      target: null,
      remaining: null,
      matchedGames: distinctMatchCount(matches.map((result) => result.matchId)),
      eligibleGames: distinctMatchCount(rows.map((result) => result.matchId)),
      unknownGames: rows.filter((result) => result.matched === null).length,
      value: null,
    };
  });
}

function changed(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) !== JSON.stringify(right);
}

function conditionSignature(conditions: ProgressCondition[]) {
  return conditions.map((condition) => ({
    key: condition.key,
    current: condition.current,
    matchedGames: condition.matchedGames,
    unknownGames: condition.unknownGames,
  }));
}

function conditionRegressed(
  condition: ProgressCondition,
  prior: ProgressCondition | undefined,
): boolean {
  return typeof prior?.current === "number" &&
    typeof condition.current === "number"
    ? condition.current < prior.current
    : false;
}

function rankDelta(evidence: ParsedEvidence | null): number {
  return (
    evidence?.rank?.targets.reduce(
      (total, target) => total + target.normalizedDelta,
      0,
    ) ?? 0
  );
}

function improvementRegressed(
  compilation: DareSqlV3Compilation,
  latest: ParsedEvidence,
  previous: ParsedEvidence | null,
): boolean {
  const current = latest.improvement?.currentValue;
  const prior = previous?.improvement?.currentValue;
  if (
    current == null ||
    prior == null ||
    compilation.activation.kind !== "improvement"
  ) {
    return false;
  }
  return compilation.activation.direction === "higher"
    ? current < prior
    : current > prior;
}

type ChangeState = {
  material: boolean;
  raceChanged: boolean;
  regressed: boolean;
};

function changeState(
  compilation: DareSqlV3Compilation,
  latest: ParsedEvidence | null,
  previous: ParsedEvidence | null,
): ChangeState {
  if (latest === null) {
    return { material: false, raceChanged: false, regressed: false };
  }
  if (latest.rank !== null) {
    const material = changed(latest.rank.targets, previous?.rank?.targets);
    return {
      material,
      raceChanged: false,
      regressed: material && rankDelta(latest) < rankDelta(previous),
    };
  }
  if (latest.improvement !== null) {
    const prior = previous?.improvement;
    const personalBest =
      compilation.activation.kind === "improvement" &&
      compilation.activation.goal.kind === "personal_best";
    const material = personalBest
      ? changed(
          [latest.improvement.bestAttempt, latest.improvement.goalMet],
          prior === null || prior === undefined
            ? null
            : [prior.bestAttempt, prior.goalMet],
        )
      : changed(
          [latest.improvement.currentValue, latest.improvement.goalMet],
          prior === null || prior === undefined
            ? null
            : [prior.currentValue, prior.goalMet],
        );
    return {
      material,
      raceChanged: false,
      regressed:
        material && improvementRegressed(compilation, latest, previous),
    };
  }
  if (latest.race !== null) {
    const raceChanged = changed(latest.race.leaders, previous?.race?.leaders);
    return { material: raceChanged, raceChanged, regressed: false };
  }
  const latestConditions = sqlProgressConditions(compilation, latest);
  const previousConditions = sqlProgressConditions(compilation, previous);
  const material =
    latest.achieved !== previous?.achieved ||
    changed(
      conditionSignature(latestConditions),
      conditionSignature(previousConditions),
    );
  const regressed = latestConditions.some((condition, index) =>
    conditionRegressed(condition, previousConditions[index]),
  );
  return {
    material,
    raceChanged: false,
    regressed,
  };
}

function materialChange(input: {
  row: StoredV3Evidence | undefined;
  evidence: ParsedEvidence | null;
  change: ChangeState;
  conditionKeys: string[];
}): DareProgress["latestMaterialChange"] {
  if (input.row === undefined || !input.change.material) return null;
  const race = input.evidence?.race;
  const summary = input.change.raceChanged
    ? race?.leaders.length === 0
      ? "The race no longer has a leader."
      : `Race leader: ${race?.leaders.join(", ") ?? "unknown"}.`
    : `SQL progress changed after match ${input.row.matchId}.`;
  return {
    kind: input.change.regressed ? "regression" : "advance",
    matchId: input.row.matchId,
    occurredAt: input.row.gameEndAt.toISOString(),
    summary,
    conditionKeys: input.conditionKeys,
  };
}

function targetProgress(input: {
  targetKey: string;
  conditions: DareProgress["conditions"];
  evidence: ParsedEvidence | null;
  matchedGames: number;
  eligibleGames: number;
  value: boolean | null;
}): DareProgress["targets"][number] {
  const targetConditions = input.conditions.filter((condition) =>
    condition.targetKeys.includes(input.targetKey),
  );
  const race = input.evidence?.race;
  return {
    targetKey: input.targetKey,
    conditionKeys: targetConditions.map((condition) => condition.key),
    matchedGames: input.matchedGames,
    eligibleGames: input.eligibleGames,
    value:
      race === null || race === undefined
        ? input.evidence?.targetDependencies.includes(input.targetKey) === true
          ? input.value
          : null
        : race.leaders.includes(input.targetKey),
  };
}

function terminalSummary(
  evidence: ParsedEvidence | null,
  value: boolean | null,
): string {
  if (value !== true) return "Dare not achieved.";
  const race = evidence?.race;
  return race === null || race === undefined
    ? "Dare achieved."
    : `Race won by ${race.leaders.join(", ")}.`;
}

function activeSummary(input: {
  evidence: ParsedEvidence | null;
  value: boolean | null;
  matchedGames: number;
}): string {
  const { evidence, value } = input;
  const race = evidence?.race;
  if (value === true) {
    return race === null || race === undefined
      ? "Current SQL conditions are satisfied; awaiting finality."
      : `Race leader: ${race.leaders.join(", ")}; awaiting the evidence watermark.`;
  }
  if (evidence?.rank !== null && evidence?.rank !== undefined) {
    return evidence.rank.targets
      .map(
        (target) =>
          `${target.targetKey}: ${rankToString(target.current)} (${target.normalizedDelta >= 0 ? "+" : ""}${target.normalizedDelta.toString()} normalized LP)`,
      )
      .join("; ");
  }
  if (evidence?.improvement !== null && evidence?.improvement !== undefined) {
    const improvement = evidence.improvement;
    return `Baseline ${improvement.baselineValue.toString()}; current ${improvement.currentValue?.toString() ?? "no eligible attempt"}; best ${improvement.bestAttempt?.toString() ?? "none"}.`;
  }
  return `${input.matchedGames.toString()} matching games across the SQL result sets.`;
}

export function deriveDareProgressV3(input: {
  compilation: DareSqlV3Compilation;
  evidence: readonly StoredV3Evidence[];
  targetKeys: readonly string[];
  final: boolean;
  finalityReason: string;
  settledValue?: boolean | null | undefined;
}): DareProgress {
  const ordered = orderedEvidence(input.evidence);
  const latestRow = ordered.at(-1);
  const latest = latestRow === undefined ? null : parseEvidence(latestRow);
  const matchedIds =
    latest?.results
      .filter((result) => result.matched === true)
      .map((result) => result.matchId) ?? [];
  const eligibleIds = latest?.results.map((result) => result.matchId) ?? [];
  const sqlConditions = sqlProgressConditions(input.compilation, latest);
  const conditions = [
    ...sqlConditions,
    ...activationConditions(input.compilation, latest),
  ];
  const previousRow = ordered.at(-2);
  const previous =
    previousRow === undefined ? null : parseEvidence(previousRow);
  const change = changeState(input.compilation, latest, previous);
  const latestMaterialChange = materialChange({
    row: latestRow,
    evidence: latest,
    change,
    conditionKeys: conditions.map((condition) => condition.key),
  });
  const value =
    input.final && input.settledValue !== undefined
      ? input.settledValue
      : (latest?.achieved ?? null);
  const matchedGames = distinctMatchCount(matchedIds);
  const eligibleGames = distinctMatchCount(eligibleIds);
  return DareProgressSchema.parse({
    value,
    final: input.final,
    finalityReason: input.finalityReason,
    matchedGames,
    eligibleGames,
    evidenceGames: ordered.length,
    conditions,
    targets: input.targetKeys.map((targetKey) =>
      targetProgress({
        targetKey,
        conditions,
        evidence: latest,
        matchedGames,
        eligibleGames,
        value,
      }),
    ),
    coverageGaps: ordered
      .filter((row) => row.coverageState === "missing_timeline")
      .map((row) => ({
        matchId: row.matchId,
        gameEndAt: row.gameEndAt.toISOString(),
        sourceReferences: SourceReferenceSchema.parse(
          JSON.parse(row.sourceReferences),
        ),
        targetKeys: latest?.targetDependencies ?? [],
        reason: "Required timeline evidence is incomplete.",
      })),
    latestMaterialChange,
    summary: input.final
      ? terminalSummary(latest, value)
      : activeSummary({ evidence: latest, value, matchedGames }),
  });
}
