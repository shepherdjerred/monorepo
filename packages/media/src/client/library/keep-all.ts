import type { DefaultTargetView } from "#shared/editions/target-view.ts";
import {
  retrySubmission,
  type TargetSubmission,
} from "#client/target-controls/mutation.ts";

/** Where one item of a "keep all" stands. */
export type KeepOutcome =
  | { status: "saving" }
  | { status: "kept" }
  | { status: "failed"; error: Error; submission: TargetSubmission | null };

export type KeepOutcomes = ReadonlyMap<string, KeepOutcome>;

export type KeepCandidate = {
  mediaId: string;
  /** The item's current default-target view, or why there is none. */
  view: DefaultTargetView | Error;
};

/** The items a run still has to keep: everything not already kept. */
export function remaining(
  candidates: readonly KeepCandidate[],
  outcomes: KeepOutcomes,
): KeepCandidate[] {
  return candidates.filter(
    (candidate) => outcomes.get(candidate.mediaId)?.status !== "kept",
  );
}

/**
 * The command to send for one item. An item whose earlier attempt has an
 * unknown result (the server failed, or never answered) is sent again
 * exactly as before, so the server recognises the repeat; an item the server
 * refused is built again from the current view.
 */
function submissionFor(
  view: DefaultTargetView,
  previous: KeepOutcome | undefined,
): TargetSubmission {
  const proposed: TargetSubmission = {
    context: view,
    command: { action: "keep" },
  };
  return previous?.status !== "failed" || previous.submission === null
    ? proposed
    : retrySubmission(
        { error: previous.error, variables: previous.submission },
        proposed,
      );
}

/**
 * Keeps each item for 30 days with the existing per-item command, one after
 * another, reporting every outcome as it lands. One item failing never stops
 * the rest, and nothing here throws: every failure is an outcome.
 */
export async function keepEach(input: {
  candidates: readonly KeepCandidate[];
  previous: KeepOutcomes;
  write: (submission: TargetSubmission) => Promise<unknown>;
  report: (mediaId: string, outcome: KeepOutcome) => void;
}): Promise<void> {
  for (const candidate of remaining(input.candidates, input.previous)) {
    const { mediaId, view } = candidate;
    if (view instanceof Error) {
      input.report(mediaId, {
        status: "failed",
        error: view,
        submission: null,
      });
      continue;
    }
    const submission = submissionFor(view, input.previous.get(mediaId));
    input.report(mediaId, { status: "saving" });
    try {
      await input.write(submission);
      input.report(mediaId, { status: "kept" });
    } catch (error) {
      input.report(mediaId, {
        status: "failed",
        error: error instanceof Error ? error : new Error(String(error)),
        submission,
      });
    }
  }
}

/** How a finished run reads, as one sentence a status region announces. */
export function keepSummary(
  outcomes: KeepOutcomes,
  total: number,
  noun: string,
): string | null {
  const settled = [...outcomes.values()];
  if (settled.some((outcome) => outcome.status === "saving")) return null;
  const kept = settled.filter((outcome) => outcome.status === "kept").length;
  const failed = settled.filter(
    (outcome) => outcome.status === "failed",
  ).length;
  if (kept === 0 && failed === 0) return null;
  if (failed === 0) {
    return kept === total
      ? `Kept all ${String(total)} ${noun} for 30 days.`
      : `Kept ${String(kept)} of ${String(total)} ${noun} for 30 days.`;
  }
  return `Kept ${String(kept)} of ${String(total)} ${noun} for 30 days. ${String(failed)} could not be kept and ${failed === 1 ? "is" : "are"} marked below.`;
}
