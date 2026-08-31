import type { ScheduleDescription } from "@temporalio/client";
import { z } from "zod";

const SearchAttributesSchema = z
  .record(
    z.string(),
    z.union([
      z.array(z.string()),
      z.array(z.number()),
      z.array(z.boolean()),
      z.array(z.date()),
    ]),
  )
  .optional();
/**
 * A schedule's `priority` carrying nothing but zero values means the same
 * thing as no priority at all. The server materializes the explicit defaults
 * on a schedule it creates, while schedules created before it did that report
 * an empty object, so a prepared target would otherwise read as drifted from
 * the source it was copied from byte for byte. A schedule that genuinely sets
 * a priority still compares as itself.
 */
const DefaultPrioritySchema = z.object({
  priorityKey: z.number().optional(),
  fairnessKey: z.string().optional(),
  fairnessWeight: z.number().optional(),
});

function isDefaultPriority(value: unknown): boolean {
  const parsed = DefaultPrioritySchema.safeParse(value);
  if (!parsed.success) return false;
  return (
    (parsed.data.priorityKey ?? 0) === 0 &&
    (parsed.data.fairnessKey ?? "") === "" &&
    (parsed.data.fairnessWeight ?? 0) === 0
  );
}

/**
 * Put a described schedule into a form two namespaces can be compared in.
 *
 * `JSON.stringify` preserves insertion order, so this has to sort object keys
 * itself: the same memo written in a different order is the same memo, and
 * comparing the raw output reported four identical Scout report schedules as
 * drifted. Array order is left alone — it is significant for `spec.intervals`
 * and for a workflow's `args`.
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry: unknown) => canonicalize(entry));
  }
  if (value === null || typeof value !== "object") return value;
  const canonical: Record<string, unknown> = {};
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, entry] of entries.sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (key === "priority" && isDefaultPriority(entry)) continue;
    canonical[key] = canonicalize(entry);
  }
  return canonical;
}

export function comparableSchedule(description: ScheduleDescription): string {
  return JSON.stringify(
    canonicalize({
      spec: description.spec,
      action: description.action,
      policies: description.policies,
      memo: description.memo,
      searchAttributes: readSearchAttributes(description),
      typedSearchAttributes: description.typedSearchAttributes,
    }),
  );
}
export function readSearchAttributes(description: ScheduleDescription) {
  return SearchAttributesSchema.parse(
    Reflect.get(description, "searchAttributes"),
  );
}
