import type { EvaluationContext } from "@openfeature/server-sdk";

export type FlagEvaluationInputs = {
  readonly entityId: string;
  readonly context: Record<string, string>;
};

/**
 * Maps an OpenFeature evaluation context onto Flags evaluation inputs.
 *
 * `targetingKey` becomes `entityId`, which hashes callers for percentage
 * rollouts. Everything else becomes the string-keyed context that segment
 * rules match against.
 *
 * Returns `undefined` when there is no usable targeting key. An empty-string
 * fallback would place every caller in the same hash bucket, so a 30% rollout
 * would read as either 0% or 100% for the whole fleet.
 */
export function toEvaluationInputs(
  context: EvaluationContext | undefined,
): FlagEvaluationInputs | undefined {
  if (context === undefined) {
    return undefined;
  }
  const { targetingKey, ...attributes } = context;
  if (typeof targetingKey !== "string" || targetingKey.length === 0) {
    return undefined;
  }

  const mapped: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributes)) {
    // Flags evaluation context is Record<string, string>. Scalars are
    // stringified with an explicit branch per type rather than String(value),
    // so a structured value cannot silently arrive as "[object Object]" and
    // match a rule that was written against a real string.
    if (typeof value === "string") {
      mapped[key] = value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      mapped[key] = String(value);
    } else if (value instanceof Date) {
      mapped[key] = value.toISOString();
    }
    // Objects and arrays are dropped. The facade's own type already rejects
    // them, so reaching this branch means a caller bypassed it.
  }

  return { entityId: targetingKey, context: mapped };
}
