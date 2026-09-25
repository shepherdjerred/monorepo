import { z } from "zod";
import {
  REPLAY_SIGNALS,
  replaySignalWeight,
} from "#src/explore/replay/signals.ts";

/**
 * Turning a bundle into something a person can read in one sitting.
 *
 * A sweep is hundreds of cases and `summary.json` only says whether the
 * harness worked. What a reviewer needs first is the shape: which gated chips
 * behaved as their guild requires, which signals fired and how often, and
 * which handful of cases to open. That is all derivable from the per-case
 * records, so it lives here as a pure function over them and is testable
 * without running anything.
 */

export const RollupCaseSchema = z
  .object({
    caseId: z.string().min(1),
    condition: z.string().nullable(),
    category: z.string().nullable(),
    expectation: z.enum(["answerable", "gated-off", "either"]).nullable(),
    status: z.enum(["ok", "error", "timeout"]),
    // Parsed as the signal enum rather than raw strings, so the weighting
    // below needs no cast and an unknown signal fails loudly at the boundary.
    signals: z.array(z.enum(REPLAY_SIGNALS)),
    answerLength: z.number().int().nonnegative(),
    rowsReturned: z.number().int().nonnegative().nullable(),
    toolNames: z.array(z.string()),
    queried: z.boolean(),
  })
  .strict();

export type RollupCase = z.infer<typeof RollupCaseSchema>;

export type ConditionRollup = {
  readonly condition: string;
  readonly cases: number;
  readonly expectation:
    "answerable" | "gated-off" | "either" | "mixed" | "none";
  /** Cases whose behaviour contradicted what the guild's capabilities require. */
  readonly violations: number;
  readonly queried: number;
  readonly medianAnswerLength: number;
};

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
}

/** The two signals that say a chip contradicted its guild's capabilities. */
const EXPECTATION_VIOLATIONS: ReadonlySet<string> = new Set<string>([
  "gated_chip_did_not_refuse",
  "ungated_chip_refused",
]);

export function rollupByCondition(
  cases: readonly RollupCase[],
): readonly ConditionRollup[] {
  const byCondition = new Map<string, RollupCase[]>();
  for (const entry of cases) {
    const key = entry.condition ?? "(none)";
    const list = byCondition.get(key);
    if (list === undefined) byCondition.set(key, [entry]);
    else list.push(entry);
  }
  return [...byCondition.entries()]
    .map(([condition, entries]): ConditionRollup => {
      const expectations = new Set(
        entries.flatMap((entry) =>
          entry.expectation === null ? [] : [entry.expectation],
        ),
      );
      return {
        condition,
        cases: entries.length,
        expectation:
          expectations.size === 0
            ? "none"
            : expectations.size > 1
              ? "mixed"
              : ([...expectations][0] ?? "none"),
        violations: entries.filter((entry) =>
          entry.signals.some((signal) => EXPECTATION_VIOLATIONS.has(signal)),
        ).length,
        queried: entries.filter((entry) => entry.queried).length,
        medianAnswerLength: median(entries.map((entry) => entry.answerLength)),
      };
    })
    .toSorted((left, right) => right.violations - left.violations);
}

export function signalTally(
  cases: readonly RollupCase[],
): readonly { readonly signal: string; readonly count: number }[] {
  const counts = new Map<string, number>();
  for (const entry of cases) {
    for (const signal of entry.signals) {
      counts.set(signal, (counts.get(signal) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([signal, count]) => ({ signal, count }))
    .toSorted((left, right) => right.count - left.count);
}

/** The cases most worth opening, worst first. */
export function worstCases(
  cases: readonly RollupCase[],
  limit: number,
): readonly RollupCase[] {
  return cases
    .filter((entry) => entry.signals.length > 0)
    .toSorted(
      (left, right) =>
        replaySignalWeight(right.signals) - replaySignalWeight(left.signals),
    )
    .slice(0, limit);
}

/** How many cases used a query tool at all — the lake-reach of a sweep. */
export function queryReach(cases: readonly RollupCase[]): {
  readonly queried: number;
  readonly answeredWithoutQuery: number;
  readonly total: number;
} {
  return {
    queried: cases.filter((entry) => entry.queried).length,
    answeredWithoutQuery: cases.filter(
      (entry) => !entry.queried && entry.status === "ok",
    ).length,
    total: cases.length,
  };
}
