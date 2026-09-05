import type { DareTruthValue } from "#src/betting/dares/evaluation/dare-evidence-v2.ts";

export function andDareTruthV2(
  values: readonly DareTruthValue[],
): DareTruthValue {
  if (values.includes(false)) return false;
  return values.includes(null) ? null : true;
}

export function orDareTruthV2(
  values: readonly DareTruthValue[],
): DareTruthValue {
  if (values.includes(true)) return true;
  return values.includes(null) ? null : false;
}
