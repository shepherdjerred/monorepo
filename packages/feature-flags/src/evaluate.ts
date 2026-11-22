/**
 * The flag language workloads use today.
 *
 * A boolean walks its segment rollouts in order and takes the first match,
 * otherwise its default. A segment matches when every constraint is string
 * equality against the context. A variant is one string.
 */

export type FlagContext = Readonly<Record<string, string>>;

export type SegmentConstraint = {
  readonly property: string;
  readonly value: string;
};

export type SegmentRollout = {
  readonly constraints: readonly SegmentConstraint[];
  readonly result: boolean;
};

export type BooleanFlagValue = {
  readonly type: "boolean";
  readonly key: string;
  readonly default: boolean;
  readonly rollouts: readonly SegmentRollout[];
};

export type VariantFlagValue = {
  readonly type: "variant";
  readonly key: string;
  readonly value: string;
};

export type FlagValue = BooleanFlagValue | VariantFlagValue;

export type FlagEvaluation<T> =
  | { readonly kind: "value"; readonly value: T }
  | { readonly kind: "missing" }
  | { readonly kind: "type-mismatch"; readonly message: string }
  | { readonly kind: "invalid"; readonly message: string };

function indexFlags(
  flags: readonly FlagValue[],
): ReadonlyMap<string, FlagValue> {
  const indexed = new Map<string, FlagValue>();
  for (const flag of flags) {
    if (indexed.has(flag.key)) {
      throw new Error(`duplicate flag key: ${flag.key}`);
    }
    indexed.set(flag.key, flag);
  }
  return indexed;
}

function segmentMatches(
  rollout: SegmentRollout,
  context: FlagContext,
): boolean {
  if (rollout.constraints.length === 0) {
    throw new Error("segment rollout has no constraints");
  }
  return rollout.constraints.every(
    (constraint) => context[constraint.property] === constraint.value,
  );
}

export function evaluateBoolean(
  flags: readonly FlagValue[],
  key: string,
  context: FlagContext,
): FlagEvaluation<boolean> {
  const flag = indexFlags(flags).get(key);
  if (flag === undefined) return { kind: "missing" };
  if (flag.type !== "boolean") {
    return {
      kind: "type-mismatch",
      message: `flag "${key}" is a ${flag.type}`,
    };
  }
  for (const rollout of flag.rollouts) {
    if (segmentMatches(rollout, context)) {
      return { kind: "value", value: rollout.result };
    }
  }
  return { kind: "value", value: flag.default };
}

export function evaluateString(
  flags: readonly FlagValue[],
  key: string,
): FlagEvaluation<string> {
  const flag = indexFlags(flags).get(key);
  if (flag === undefined) return { kind: "missing" };
  if (flag.type !== "variant") {
    return {
      kind: "type-mismatch",
      message: `flag "${key}" is a ${flag.type}`,
    };
  }
  return { kind: "value", value: flag.value };
}

export const evaluateVariant = evaluateString;

export function evaluateNumber(
  flags: readonly FlagValue[],
  key: string,
): FlagEvaluation<number> {
  const evaluated = evaluateString(flags, key);
  if (evaluated.kind !== "value") return evaluated;
  if (evaluated.value.trim().length === 0) {
    return {
      kind: "invalid",
      message: `variant "${evaluated.value}" for flag "${key}" is not a number`,
    };
  }
  const value = Number(evaluated.value);
  if (!Number.isFinite(value)) {
    return {
      kind: "invalid",
      message: `variant "${evaluated.value}" for flag "${key}" is not a number`,
    };
  }
  return { kind: "value", value };
}

/** List state. A boolean with any rollout is targeted, even when the default agrees. */
export function booleanPresence(
  flag: BooleanFlagValue,
): "on" | "off" | "targeted" {
  if (flag.rollouts.length > 0) return "targeted";
  return flag.default ? "on" : "off";
}
