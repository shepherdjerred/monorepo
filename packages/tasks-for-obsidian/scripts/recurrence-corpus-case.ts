/**
 * Recurrence corpus — shared case vocabulary.
 *
 * Split out of `build-recurrence-corpus.ts` only to keep each file inside the
 * repository's 500-line limit; see that file for the contract this corpus
 * snapshots.
 */

export type CaseSource = "edge" | "generated" | "harvested";

export type CaseInput = {
  readonly group: string;
  readonly recurrence: string;
  /** Primary DTSTART source when the rule embeds no `DTSTART:`. */
  readonly scheduled: string | null;
  /** Secondary DTSTART source, consulted only when `scheduled` is absent. */
  readonly dateCreated: string | null;
  readonly source: CaseSource;
  readonly note: string | null;
};

/**
 * `| undefined` on every optional field is required, not noise: the package
 * compiles with `exactOptionalPropertyTypes`, and several grid builders pass
 * `note: <cond> ? "..." : undefined` inline.
 */
type PartialCase = {
  readonly group: string;
  readonly recurrence: string;
  readonly scheduled?: string | null | undefined;
  readonly dateCreated?: string | null | undefined;
  readonly source?: CaseSource | undefined;
  readonly note?: string | undefined;
};

/** A Monday, so `BYDAY=MO` rules start on their own DTSTART. */
const DEFAULT_SCHEDULED = "2026-01-05";

export function makeCase(partial: PartialCase): CaseInput {
  return {
    group: partial.group,
    recurrence: partial.recurrence,
    scheduled:
      partial.scheduled === undefined ? DEFAULT_SCHEDULED : partial.scheduled,
    dateCreated: partial.dateCreated ?? null,
    source: partial.source ?? "generated",
    note: partial.note ?? null,
  };
}

export const FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const;
export const INTERVALS = [1, 2, 3] as const;

export function withInterval(base: string, interval: number): string {
  return interval === 1 ? base : `${base};INTERVAL=${String(interval)}`;
}
