import type { CaseSummary } from "#shared/schema.ts";

export type FreshnessAvailability = {
  generatedCaseCount: number;
  isAvailable: boolean;
  missingRatingCount: number;
  styleKeys: string[];
};

export function freshnessAvailability(
  cases: CaseSummary[],
): FreshnessAvailability {
  const generatedCases = cases.filter(
    (evalCase) => evalCase.generationId !== null,
  );
  const missingRatingCount = generatedCases.filter(
    (evalCase) => !evalCase.isRated,
  ).length;

  return {
    generatedCaseCount: generatedCases.length,
    isAvailable: generatedCases.length > 0 && missingRatingCount === 0,
    missingRatingCount,
    styleKeys: [
      ...new Set(generatedCases.map((evalCase) => evalCase.styleKey)),
    ],
  };
}
