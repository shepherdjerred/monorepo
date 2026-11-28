export type ReleaseEvaluation = {
  accepted: boolean;
  reasons: string[];
  qualityRank: number;
  score: number;
  fallbackDistanceBytes?: number;
};

export function acceptedFallbackReasons(evaluation: ReleaseEvaluation) {
  return evaluation.fallbackDistanceBytes === undefined
    ? []
    : evaluation.reasons;
}
