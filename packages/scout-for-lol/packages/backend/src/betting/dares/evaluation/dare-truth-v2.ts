import type { DareTruthValue } from "#src/betting/dares/evaluation/dare-evidence-v2.ts";

export function andDareTruthV2(
  values: readonly DareTruthValue[],
): DareTruthValue {
  return !values.includes(false) && (!values.includes(null) || null);
}

export function orDareTruthV2(
  values: readonly DareTruthValue[],
): DareTruthValue {
  return values.includes(true) || (values.includes(null) && null);
}
