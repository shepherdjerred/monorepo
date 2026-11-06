import { vi } from "vitest";
import type { PublicationAuthorityReadBudget } from "@shepherdjerred/media/publication-authority-budget";

export type MovieRollbackReadCharge = { count: number; frames: string[] };

/** Diagnostic only: forwards every charge into the same original capability. */
export async function traceOriginalMovieReads<T>(
  budget: PublicationAuthorityReadBudget,
  input: { reads: MovieRollbackReadCharge[]; work: () => Promise<T> },
) {
  const consume = budget.consume.bind(budget);
  const trace = vi.spyOn(budget, "consume").mockImplementation((count) => {
    input.reads.push({
      count,
      frames: (new Error("Actual original movie read charge").stack ?? "")
        .split("\n")
        .filter((frame) => frame.includes("packages/media/src/"))
        .map((frame) => frame.slice(frame.indexOf("packages/media/src/")))
        .slice(0, 4),
    });
    consume(count);
  });
  try {
    return await input.work();
  } finally {
    trace.mockRestore();
  }
}
