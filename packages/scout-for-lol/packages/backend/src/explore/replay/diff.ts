/**
 * Comparing a replayed turn against what it is being measured off.
 *
 * "Baseline" is two different things depending on the case. A conversation
 * turn has a stored original — the answer a real person actually received. A
 * chip never shipped an answer at all, so its baseline is a previous run of
 * the same chip under the same profile. The source is carried explicitly
 * because a reviewer reads those two very differently.
 *
 * Nothing here decides whether a difference is bad. The original answer was
 * computed against an older lake, so today's agent over today's lake can
 * legitimately return different numbers for the same question. This module
 * reports what changed; `signals.ts` flags the subset worth looking at first,
 * and a person decides.
 */

import { z } from "zod";

/**
 * The stored shape of a comparison, for readers that cannot rebuild it.
 *
 * A bundle records the diff a run computed. Re-scoring offline has the
 * candidate but not the baseline — that lived in another bundle — so the
 * recorded comparison is the only way the baseline-dependent signals survive
 * a re-score. Loose, because a bundle written later may carry more.
 */
export const ReplayDiffSchema = z
  .object({
    baselineSource: z.enum(["stored", "run"]),
    baselineCreatedAt: z.string().nullable(),
    answer: z
      .object({
        identical: z.boolean(),
        baselineLength: z.number(),
        candidateLength: z.number(),
        numbersOnlyInBaseline: z.array(z.string()),
        numbersOnlyInCandidate: z.array(z.string()),
      })
      .loose(),
    query: z
      .object({
        status: z.enum(["identical", "changed", "added", "removed", "absent"]),
        baseline: z.string().nullable(),
        candidate: z.string().nullable(),
      })
      .loose(),
    toolCalls: z
      .object({
        baseline: z.array(z.string()),
        candidate: z.array(z.string()),
        added: z.array(z.string()),
        removed: z.array(z.string()),
        reordered: z.boolean(),
      })
      .loose(),
    rows: z
      .object({
        returnedDelta: z.number().nullable(),
        scannedDelta: z.number().nullable(),
      })
      .loose(),
    caveats: SetDiffSchema(),
    followUps: SetDiffSchema(),
    matchCards: SetDiffSchema(),
    visualizationChanged: z.boolean(),
  })
  .loose();

function SetDiffSchema() {
  return z
    .object({ added: z.array(z.string()), removed: z.array(z.string()) })
    .loose();
}

export type ReplaySide = {
  readonly answer: string | null;
  readonly queryText: string | null;
  readonly caveats: readonly string[];
  readonly followUps: readonly string[];
  readonly rowsReturned: number | null;
  readonly rowsScanned: number | null;
  /** Tool names in call order, duplicates kept. */
  readonly toolNames: readonly string[];
  readonly matchCardIds: readonly string[];
  readonly visualizationKind: string | null;
};

export type ReplayBaseline = ReplaySide & {
  readonly source: "stored" | "run";
  /**
   * When the stored answer was written, or null for a run baseline.
   *
   * Carried so a reviewer can weigh a numeric difference against how much lake
   * has landed since — a six-month-old answer disagreeing about a win rate is
   * not evidence of anything.
   */
  readonly createdAt: string | null;
};

export type AnswerDiff = {
  readonly identical: boolean;
  readonly baselineLength: number;
  readonly candidateLength: number;
  /** Figures the baseline asserted that the candidate no longer does, and vice versa. */
  readonly numbersOnlyInBaseline: readonly string[];
  readonly numbersOnlyInCandidate: readonly string[];
};

export type QueryDiff = {
  readonly status: "identical" | "changed" | "added" | "removed" | "absent";
  readonly baseline: string | null;
  readonly candidate: string | null;
};

export type ToolCallDiff = {
  readonly baseline: readonly string[];
  readonly candidate: readonly string[];
  readonly added: readonly string[];
  readonly removed: readonly string[];
  /** Same multiset of tools, different order. */
  readonly reordered: boolean;
};

export type SetDiff = {
  readonly added: readonly string[];
  readonly removed: readonly string[];
};

export type ReplayDiff = {
  readonly baselineSource: "stored" | "run";
  readonly baselineCreatedAt: string | null;
  readonly answer: AnswerDiff;
  readonly query: QueryDiff;
  readonly toolCalls: ToolCallDiff;
  readonly rows: {
    readonly returnedDelta: number | null;
    readonly scannedDelta: number | null;
  };
  readonly caveats: SetDiff;
  readonly followUps: SetDiff;
  readonly matchCards: SetDiff;
  readonly visualizationChanged: boolean;
};

/**
 * Every figure a piece of prose asserts.
 *
 * Thousands separators are stripped first so "1,234" and "1234" are the same
 * claim, and a trailing decimal zero is normalized so "54.0" matches "54" —
 * otherwise the most common column in the bundle fills with differences that
 * are not differences. Percent signs and units are left off the token: what
 * matters is whether the number survived, not how it was decorated.
 */
export function numericClaims(text: string | null): ReadonlySet<string> {
  if (text === null) return new Set();
  const withoutSeparators = text.replaceAll(/(?<=\d),(?=\d{3}\b)/g, "");
  // The sign is part of the claim: "-5 LP" and "5 LP" are opposite results,
  // and dropping the minus made them compare as the same figure. A hyphen only
  // counts when nothing numeric precedes it, so a range or a date keeps its
  // parts positive rather than turning "2024-05" into a negative five.
  const found = withoutSeparators.match(/(?<![\d.])-?\d+(?:\.\d+)?/g) ?? [];
  return new Set(
    found.map((token) => {
      const value = Number(token);
      return Number.isFinite(value) ? String(value) : token;
    }),
  );
}

function difference(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): readonly string[] {
  return [...left].filter((entry) => !right.has(entry)).toSorted();
}

function setDiff(
  baseline: readonly string[],
  candidate: readonly string[],
): SetDiff {
  const before = new Set(baseline);
  const after = new Set(candidate);
  return {
    added: difference(after, before),
    removed: difference(before, after),
  };
}

function queryDiff(
  baseline: string | null,
  candidate: string | null,
  normalize: (text: string) => string | null,
): QueryDiff {
  // Normalized before comparison so a formatting change — which the formatter
  // can introduce on its own — is not reported as the agent writing a
  // different query.
  const before = baseline === null ? null : (normalize(baseline) ?? baseline);
  const after = candidate === null ? null : (normalize(candidate) ?? candidate);
  if (before === null && after === null) {
    return { status: "absent", baseline: null, candidate: null };
  }
  if (before === null) {
    return { status: "added", baseline: null, candidate: after };
  }
  if (after === null) {
    return { status: "removed", baseline: before, candidate: null };
  }
  return {
    status: before === after ? "identical" : "changed",
    baseline: before,
    candidate: after,
  };
}

/**
 * Multiset difference: how many of each name one side has that the other does
 * not, one entry per surplus call.
 *
 * Set semantics would be wrong here in the case that matters most. A baseline
 * that retried `run_report_query` twice against a candidate that called it
 * once shares the same *set* of tools, so a set difference reports nothing
 * changed — hiding exactly the retry behaviour the trace is read for.
 */
function multisetDifference(
  left: readonly string[],
  right: readonly string[],
): readonly string[] {
  const remaining = new Map<string, number>();
  for (const name of right) {
    remaining.set(name, (remaining.get(name) ?? 0) + 1);
  }
  const surplus: string[] = [];
  for (const name of left) {
    const count = remaining.get(name) ?? 0;
    if (count > 0) {
      remaining.set(name, count - 1);
    } else {
      surplus.push(name);
    }
  }
  return surplus.toSorted();
}

function toolCallDiff(
  baseline: readonly string[],
  candidate: readonly string[],
): ToolCallDiff {
  const added = multisetDifference(candidate, baseline);
  const removed = multisetDifference(baseline, candidate);
  // Only meaningful when nothing was added or removed: otherwise "reordered"
  // would be a second, confusing way of saying the tools changed.
  const reordered =
    added.length === 0 &&
    removed.length === 0 &&
    baseline.length === candidate.length &&
    baseline.some((name, index) => candidate[index] !== name);
  return { baseline, candidate, added, removed, reordered };
}

function delta(
  baseline: number | null,
  candidate: number | null,
): number | null {
  return baseline === null || candidate === null ? null : candidate - baseline;
}

export function diffReplayCase(input: {
  readonly baseline: ReplayBaseline;
  readonly candidate: ReplaySide;
  /**
   * Canonical form of a query, so formatting is not mistaken for meaning.
   * Returning null means "could not be normalized"; the raw text is then
   * compared, which is worse but never silently wrong.
   */
  readonly normalizeQuery: (text: string) => string | null;
}): ReplayDiff {
  const { baseline, candidate } = input;
  const baselineNumbers = numericClaims(baseline.answer);
  const candidateNumbers = numericClaims(candidate.answer);

  return {
    baselineSource: baseline.source,
    baselineCreatedAt: baseline.createdAt,
    answer: {
      identical: baseline.answer === candidate.answer,
      baselineLength: baseline.answer?.length ?? 0,
      candidateLength: candidate.answer?.length ?? 0,
      numbersOnlyInBaseline: difference(baselineNumbers, candidateNumbers),
      numbersOnlyInCandidate: difference(candidateNumbers, baselineNumbers),
    },
    query: queryDiff(
      baseline.queryText,
      candidate.queryText,
      input.normalizeQuery,
    ),
    toolCalls: toolCallDiff(baseline.toolNames, candidate.toolNames),
    rows: {
      returnedDelta: delta(baseline.rowsReturned, candidate.rowsReturned),
      scannedDelta: delta(baseline.rowsScanned, candidate.rowsScanned),
    },
    caveats: setDiff(baseline.caveats, candidate.caveats),
    followUps: setDiff(baseline.followUps, candidate.followUps),
    matchCards: setDiff(baseline.matchCardIds, candidate.matchCardIds),
    visualizationChanged:
      baseline.visualizationKind !== candidate.visualizationKind,
  };
}
