/** Stage keys the API and the step executor share (T3). */

/**
 * The stage key of a frozen recipe step. Stage keys double as native Job
 * stage keys, so they are lower-case words joined by hyphens:
 * `step-<kind>` and `test-<suite>`.
 */
export function stepStageKey(prefix: "step" | "test", name: string): string {
  const key = `${prefix}-${name.toLowerCase().replaceAll(/[^a-z0-9-]+/gu, "-")}`;
  if (!/^[a-z0-9-]{1,64}$/u.test(key))
    throw new Error(`Step ${name} has no valid stage key`);
  return key;
}

/** A compound sub-recipe's step key: unique across sub-recipes, still a Job stage key (T3). */
export function subRecipeStageKey(index: number, key: string): string {
  const prefixed = `sub${String(index + 1)}-${key}`;
  if (!/^[a-z0-9-]{1,64}$/u.test(prefixed))
    throw new Error(`Sub-recipe step key ${prefixed} is not a stage key`);
  return prefixed;
}

/** The stage a human approval of a model tofu deployment's saved plan settles. */
export const PLAN_APPROVAL_STAGE_KEY = "approve/plan";

/** The stage an operator attestation of a declared operator-run stage settles. */
export function attestationStageKey(stage: string): string {
  return `attest/${stage}`;
}
