import {
  DareProgressSchema,
  DareSqlV3EvidenceSchema,
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

export function deriveDareProgressV3(input: {
  compilation: DareSqlV3Compilation;
  evidence: readonly StoredV3Evidence[];
  targetKeys: readonly string[];
  final: boolean;
  finalityReason: string;
}): DareProgress {
  const ordered = input.evidence.toSorted((left, right) => {
    const time = left.gameEndAt.getTime() - right.gameEndAt.getTime();
    return time === 0 ? left.matchId.localeCompare(right.matchId) : time;
  });
  const latestRow = ordered.at(-1);
  const latest = latestRow === undefined ? null : parseEvidence(latestRow);
  const matchedIds =
    latest?.results
      .filter((result) => result.matched === true)
      .map((result) => result.matchId) ?? [];
  const eligibleIds = latest?.results.map((result) => result.matchId) ?? [];
  const conditions = input.compilation.resultStructure.gameSets.map(
    (gameSet, index) => {
      const rows =
        latest?.results.filter((result) => result.gameSet === gameSet.name) ??
        [];
      const matches = rows.filter((result) => result.matched === true);
      return {
        key: index.toString(),
        kind: "sql_result_set",
        label: `${gameSet.name} SQL result`,
        targetKeys: gameSet.targetDependencies,
        gameSet: gameSet.name,
        operator: null,
        current: distinctMatchCount(matches.map((result) => result.matchId)),
        target: null,
        remaining: null,
        matchedGames: distinctMatchCount(
          matches.map((result) => result.matchId),
        ),
        eligibleGames: distinctMatchCount(rows.map((result) => result.matchId)),
        unknownGames: rows.filter((result) => result.matched === null).length,
        value: null,
      };
    },
  );
  const previousRow = ordered.at(-2);
  const previous =
    previousRow === undefined ? null : parseEvidence(previousRow);
  const materialChange =
    latestRow === undefined ||
    JSON.stringify(latest) === JSON.stringify(previous)
      ? null
      : {
          kind: "advance" as const,
          matchId: latestRow.matchId,
          occurredAt: latestRow.gameEndAt.toISOString(),
          summary: `SQL progress changed after match ${latestRow.matchId}.`,
          conditionKeys: conditions.map((condition) => condition.key),
        };
  const value = latest?.achieved ?? null;
  return DareProgressSchema.parse({
    value,
    final: input.final,
    finalityReason: input.finalityReason,
    matchedGames: distinctMatchCount(matchedIds),
    eligibleGames: distinctMatchCount(eligibleIds),
    evidenceGames: ordered.length,
    conditions,
    targets: input.targetKeys.map((targetKey) => {
      const targetConditions = conditions.filter((condition) =>
        condition.targetKeys.includes(targetKey),
      );
      return {
        targetKey,
        conditionKeys: targetConditions.map((condition) => condition.key),
        matchedGames: distinctMatchCount(matchedIds),
        eligibleGames: distinctMatchCount(eligibleIds),
        value:
          latest?.targetDependencies.includes(targetKey) === true
            ? value
            : null,
      };
    }),
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
    latestMaterialChange: materialChange,
    summary: input.final
      ? value === true
        ? "Dare achieved."
        : "Dare not achieved."
      : value === true
        ? "Current SQL conditions are satisfied; awaiting finality."
        : `${distinctMatchCount(matchedIds).toString()} matching games across the SQL result sets.`,
  });
}
