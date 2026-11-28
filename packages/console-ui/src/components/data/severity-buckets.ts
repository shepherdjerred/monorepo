import { z } from "zod";
import { SEVERITY_LABEL } from "@shepherdjerred/console-ui/components/status-glyph.tsx";
import {
  SEVERITIES,
  type Severity,
} from "@shepherdjerred/console-ui/tokens.ts";

const SeveritySchema = z.enum(SEVERITIES);

/** Worst first: error 4, warning 3, unknown 2, info 1, ok 0. */
export const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  error: 4,
  warning: 3,
  unknown: 2,
  info: 1,
  ok: 0,
};

/** The severity a group value names, or undefined for any other value. */
export function parseSeverity(value: string): Severity | undefined {
  const parsed = SeveritySchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** The rank of a severity name, or -1 for anything else. */
export function severityRank(value: string): number {
  const severity = parseSeverity(value);
  return severity === undefined ? -1 : SEVERITY_RANK[severity];
}

/**
 * Groups items into one bucket per severity (or any key), worst first by
 * `rank`. Items keep their original order inside a bucket, so a sorted list
 * stays sorted within each group.
 */
export function bucketBySeverity<Item, Sev>(
  items: readonly Item[],
  severityOf: (item: Item) => Sev,
  rank: (severity: Sev) => number,
): [Sev, Item[]][] {
  const buckets = new Map<Sev, Item[]>();
  for (const item of items) {
    const severity = severityOf(item);
    const bucket = buckets.get(severity) ?? [];
    bucket.push(item);
    buckets.set(severity, bucket);
  }
  return [...buckets.entries()].toSorted(
    ([left], [right]) => rank(right) - rank(left),
  );
}

/** How a `DataTable` splits its rows into heading-led groups. */
export type DataTableGroupBy<T> = {
  /** The group a row belongs to. */
  readonly value: (row: T) => string;
  /** Higher ranks come first (worst first for severities). */
  readonly rank: (group: string) => number;
  /** The heading's word; defaults to the group value. */
  readonly label?: ((group: string) => string) | undefined;
  /** Draws the heading with this severity's glyph. */
  readonly severity?: ((group: string) => Severity | undefined) | undefined;
};

/** Group rows by their severity, worst first, headed "Error", "Warning"… */
export function groupBySeverity<T>(
  severityOf: (row: T) => Severity,
): DataTableGroupBy<T> {
  return {
    value: severityOf,
    rank: severityRank,
    label: (group) => {
      const severity = parseSeverity(group);
      return severity === undefined ? group : SEVERITY_LABEL[severity];
    },
    severity: parseSeverity,
  };
}
