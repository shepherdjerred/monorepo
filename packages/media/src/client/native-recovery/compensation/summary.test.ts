import { describe, expect, it } from "vitest";
import { restorationSummary } from "./summary.ts";

const TRANSITION = "00000027-0000-4000-8000-000000000032";

function scope(entries: number) {
  return {
    transition: { transitionId: TRANSITION },
    intent: { transitionId: TRANSITION },
    interruptedWork: { transitionId: TRANSITION },
    entries: Array.from({ length: entries }, (_, index) => ({ index })),
  };
}

describe("what the restoration confirmation counts", () => {
  it("counts two file entries of one upgrade as one upgrade and two files", () => {
    expect(restorationSummary(scope(2))).toEqual({ upgrades: 1, files: 2 });
  });

  it("counts one file entry of one upgrade as one of each", () => {
    expect(restorationSummary(scope(1))).toEqual({ upgrades: 1, files: 1 });
  });
});
