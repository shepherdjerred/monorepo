import {
  booleanPresence,
  type BooleanFlagValue,
  type FlagValue,
  type VariantFlagValue,
} from "@shepherdjerred/feature-flags/evaluate.ts";

const STAGE_LABELS: Readonly<Record<string, string>> = {
  beta: "Beta",
  prod: "Prod",
};

export type Route = {
  readonly catalog: string;
  readonly stage: string;
  readonly key?: string;
};

export type SidebarEntry =
  | { readonly kind: "single"; readonly id: string; readonly label: string }
  | {
      readonly kind: "group";
      readonly catalog: string;
      readonly stages: readonly {
        readonly id: string;
        readonly label: string;
      }[];
    };

export function parseRoute(pathname: string): Route | undefined {
  const parts = pathname.split("/").filter((part) => part.length > 0);
  const catalog = parts[0];
  const stage = parts[1];
  if (catalog === undefined || stage === undefined || parts.length > 3)
    return undefined;
  const key = parts[2];
  return key === undefined
    ? { catalog: decodeURIComponent(catalog), stage: decodeURIComponent(stage) }
    : {
        catalog: decodeURIComponent(catalog),
        stage: decodeURIComponent(stage),
        key: decodeURIComponent(key),
      };
}

export function deploymentPath(catalog: string, stage: string): string {
  return `/${encodeURIComponent(catalog)}/${encodeURIComponent(stage)}`;
}

export function flagPath(catalog: string, stage: string, key: string): string {
  return `${deploymentPath(catalog, stage)}/${encodeURIComponent(key)}`;
}

export function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

export function sidebarEntries(ids: readonly string[]): SidebarEntry[] {
  const groups = new Map<string, { id: string; stage: string }[]>();
  for (const id of [...ids].sort()) {
    const slash = id.indexOf("/");
    const catalog = id.slice(0, slash);
    const stage = id.slice(slash + 1);
    if (slash <= 0 || stage.length === 0 || stage.includes("/")) {
      throw new Error(`deployment id ${id} is not catalog/stage`);
    }
    const list = groups.get(catalog) ?? [];
    list.push({ id, stage });
    groups.set(catalog, list);
  }
  return [...groups.entries()].map(([catalog, stages]) => {
    const only = stages[0];
    return only !== undefined && stages.length === 1
      ? {
          kind: "single" as const,
          id: only.id,
          label: only.stage === "prod" ? catalog : only.id,
        }
      : {
          kind: "group" as const,
          catalog,
          stages: stages.map((stage) => ({
            id: stage.id,
            label: stageLabel(stage.stage),
          })),
        };
  });
}

export function listState(flag: FlagValue): string {
  if (flag.type === "variant")
    return flag.value.length === 0 ? "(empty)" : flag.value;
  const presence = booleanPresence(flag);
  return presence === "on" ? "On" : presence === "off" ? "Off" : "Targeted";
}

export function sameFlag(left: FlagValue, right: FlagValue): boolean {
  if (left.type !== right.type || left.key !== right.key) return false;
  if (left.type === "variant" && right.type === "variant")
    return left.value === right.value;
  if (left.type !== "boolean" || right.type !== "boolean") return false;
  if (
    left.default !== right.default ||
    left.rollouts.length !== right.rollouts.length
  )
    return false;
  return left.rollouts.every((rollout, index) => {
    const other = right.rollouts[index];
    if (other?.result !== rollout.result) return false;
    if (rollout.constraints.length !== other.constraints.length) return false;
    return rollout.constraints.every((constraint, constraintIndex) => {
      const theirs = other.constraints[constraintIndex];
      return (
        theirs?.property === constraint.property &&
        theirs.value === constraint.value
      );
    });
  });
}

export function draftError(flag: FlagValue): string | undefined {
  if (flag.type === "variant") return undefined;
  for (const [index, rollout] of flag.rollouts.entries()) {
    if (rollout.constraints.length === 0)
      return `Segment ${String(index + 1)} has no constraints`;
    const blank = rollout.constraints.some(
      (constraint) =>
        constraint.property.trim().length === 0 ||
        constraint.value.trim().length === 0,
    );
    if (blank) return `Segment ${String(index + 1)} has an empty constraint`;
  }
  return undefined;
}

export function flagText(flag: FlagValue): string {
  return JSON.stringify(flag, null, 2);
}

export function setBooleanDefault(
  flag: BooleanFlagValue,
  on: boolean,
): BooleanFlagValue {
  return {
    type: flag.type,
    key: flag.key,
    default: on,
    rollouts: flag.rollouts,
  };
}

export function setVariantValue(
  flag: VariantFlagValue,
  value: string,
): VariantFlagValue {
  return { type: flag.type, key: flag.key, value };
}

export function addSegment(flag: BooleanFlagValue): BooleanFlagValue {
  return {
    type: flag.type,
    key: flag.key,
    default: flag.default,
    rollouts: [
      ...flag.rollouts,
      { constraints: [{ property: "", value: "" }], result: true },
    ],
  };
}

export function removeSegment(
  flag: BooleanFlagValue,
  index: number,
): BooleanFlagValue {
  return {
    type: flag.type,
    key: flag.key,
    default: flag.default,
    rollouts: flag.rollouts.filter((_, rolloutIndex) => rolloutIndex !== index),
  };
}

export function setSegmentResult(
  flag: BooleanFlagValue,
  index: number,
  result: boolean,
): BooleanFlagValue {
  return {
    type: flag.type,
    key: flag.key,
    default: flag.default,
    rollouts: flag.rollouts.map((rollout, rolloutIndex) =>
      rolloutIndex === index
        ? { constraints: rollout.constraints, result }
        : rollout,
    ),
  };
}

export function setConstraintField(
  flag: BooleanFlagValue,
  target: {
    readonly rolloutIndex: number;
    readonly constraintIndex: number;
    readonly field: "property" | "value";
    readonly value: string;
  },
): BooleanFlagValue {
  return {
    type: flag.type,
    key: flag.key,
    default: flag.default,
    rollouts: flag.rollouts.map((rollout, index) =>
      index === target.rolloutIndex
        ? {
            constraints: rollout.constraints.map((constraint, current) => {
              if (current !== target.constraintIndex) return constraint;
              return target.field === "property"
                ? { property: target.value, value: constraint.value }
                : { property: constraint.property, value: target.value };
            }),
            result: rollout.result,
          }
        : rollout,
    ),
  };
}

export function addConstraint(
  flag: BooleanFlagValue,
  rolloutIndex: number,
): BooleanFlagValue {
  return {
    type: flag.type,
    key: flag.key,
    default: flag.default,
    rollouts: flag.rollouts.map((rollout, index) =>
      index === rolloutIndex
        ? {
            constraints: [...rollout.constraints, { property: "", value: "" }],
            result: rollout.result,
          }
        : rollout,
    ),
  };
}

export function removeConstraint(
  flag: BooleanFlagValue,
  rolloutIndex: number,
  constraintIndex: number,
): BooleanFlagValue {
  return {
    type: flag.type,
    key: flag.key,
    default: flag.default,
    rollouts: flag.rollouts.map((rollout, index) =>
      index === rolloutIndex
        ? {
            constraints: rollout.constraints.filter(
              (_, current) => current !== constraintIndex,
            ),
            result: rollout.result,
          }
        : rollout,
    ),
  };
}
