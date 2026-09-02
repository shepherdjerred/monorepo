import { DARE_EVALUATOR_V2_VERSION } from "@scout-for-lol/data";
import {
  evaluateDareEvidenceV2,
  evaluateDareMatchV2,
} from "#src/betting/dare-evaluator-v2.ts";
import {
  analyzeDareFinalityV2,
  buildDareProofV2,
} from "#src/betting/dare-proof-v2.ts";

export type DareEvaluatorImplementationV2 = {
  evaluateEvidence: typeof evaluateDareEvidenceV2;
  evaluateMatch: typeof evaluateDareMatchV2;
  analyzeFinality: typeof analyzeDareFinalityV2;
  buildProof: typeof buildDareProofV2;
};

const CURRENT_EVALUATOR: DareEvaluatorImplementationV2 = {
  evaluateEvidence: evaluateDareEvidenceV2,
  evaluateMatch: evaluateDareMatchV2,
  analyzeFinality: analyzeDareFinalityV2,
  buildProof: buildDareProofV2,
};

export function dareEvaluatorImplementationV2(
  version: string,
): DareEvaluatorImplementationV2 {
  if (version === DARE_EVALUATOR_V2_VERSION) return CURRENT_EVALUATOR;
  throw new Error(`Unsupported Dare v2 evaluator version ${version}.`);
}
