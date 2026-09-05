import type { DareValueV2 } from "@scout-for-lol/data";

export type DareValuePrimitiveV2 = "boolean" | "invalid" | "number" | "string";

export function dareValueNeedsTimeline(value: DareValueV2): boolean {
  if (value.kind === "timeline_event_count") return true;
  return (
    value.kind === "arithmetic" &&
    (dareValueNeedsTimeline(value.left) || dareValueNeedsTimeline(value.right))
  );
}

export function dareValueDepth(value: DareValueV2): number {
  return value.kind === "arithmetic"
    ? 1 + Math.max(dareValueDepth(value.left), dareValueDepth(value.right))
    : 1;
}

export function dareValueRelatedRelationCount(value: DareValueV2): number {
  if (value.kind === "related_participant_count") return 1;
  return value.kind === "arithmetic"
    ? dareValueRelatedRelationCount(value.left) +
        dareValueRelatedRelationCount(value.right)
    : 0;
}

export function dareValueTargetKeys(value: DareValueV2): string[] {
  if (value.kind === "arithmetic") {
    return [
      ...dareValueTargetKeys(value.left),
      ...dareValueTargetKeys(value.right),
    ];
  }
  if (
    value.kind === "participant" ||
    value.kind === "participant_rate" ||
    value.kind === "related_participant_count"
  ) {
    return [value.target];
  }
  return value.kind === "timeline_event_count" && value.target !== null
    ? [value.target]
    : [];
}

export function dareValuePrimitiveType(
  value: DareValueV2,
): DareValuePrimitiveV2 {
  if (value.kind === "arithmetic") {
    return dareValuePrimitiveType(value.left) === "number" &&
      dareValuePrimitiveType(value.right) === "number"
      ? "number"
      : "invalid";
  }
  if (value.kind === "participant") {
    if (value.field === "champion_name" || value.field === "team_position") {
      return "string";
    }
    return value.field === "win" ? "boolean" : "number";
  }
  if (value.kind === "game") {
    return value.field === "queue" ? "string" : "number";
  }
  return "number";
}
