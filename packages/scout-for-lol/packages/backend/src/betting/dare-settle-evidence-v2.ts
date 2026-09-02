import {
  DareMatchEvidenceV2Schema,
  type DareMatchEvidenceV2,
} from "#src/betting/dare-evidence-v2.ts";

export function storedDareV2Evidence(row: {
  matchId: string;
  gameStartAt: Date;
  gameEndAt: Date;
  queueType: string;
  candidateMembership: string;
  evaluationOutput: string;
  coverageState: string;
  targetDependencies: string;
  sourceReferences: string;
  evaluationTrace: string;
}): DareMatchEvidenceV2 {
  const output: unknown = JSON.parse(row.evaluationOutput);
  if (typeof output !== "object" || output === null) {
    throw new Error(
      `Dare v2 evidence ${row.matchId} has invalid evaluation output.`,
    );
  }
  return DareMatchEvidenceV2Schema.parse({
    matchId: row.matchId,
    gameStartAt: row.gameStartAt.toISOString(),
    gameEndAt: row.gameEndAt.toISOString(),
    queue: row.queueType,
    candidateSets: JSON.parse(row.candidateMembership),
    ...output,
    coverageState: row.coverageState,
    targetDependencies: JSON.parse(row.targetDependencies),
    sourceReferences: JSON.parse(row.sourceReferences),
    evaluationTrace: JSON.parse(row.evaluationTrace),
  });
}

export function dareV2EvidenceCreateData(
  dareId: number,
  evidence: DareMatchEvidenceV2,
  planVersion: string,
) {
  return {
    dareId,
    matchId: evidence.matchId,
    gameStartAt: new Date(evidence.gameStartAt),
    gameEndAt: new Date(evidence.gameEndAt),
    queueType: evidence.queue,
    candidateMembership: JSON.stringify(evidence.candidateSets),
    sourceReferences: JSON.stringify(evidence.sourceReferences),
    evaluationOutput: JSON.stringify({
      setResults: evidence.setResults,
      setValues: evidence.setValues,
    }),
    coverageState: evidence.coverageState,
    targetDependencies: JSON.stringify(evidence.targetDependencies),
    evaluationTrace: JSON.stringify(evidence.evaluationTrace),
    planVersion,
  };
}

type DareV2EvidenceVersionContract =
  | { compilerVersion: "dare-scoutql-1"; evaluatorVersion: string }
  | { compilerVersion: "dare-scoutql-2"; evaluatorVersion: string }
  | {
      compilerVersion: "dare-scoutql-2";
      evaluatorVersion: string;
      scoutQlPlanHash: string;
    };

export function dareV2EvidencePlanVersion(
  contract: DareV2EvidenceVersionContract,
): string {
  const versions = `${contract.compilerVersion}:${contract.evaluatorVersion}`;
  return "scoutQlPlanHash" in contract
    ? `${versions}:${contract.scoutQlPlanHash}`
    : versions;
}
