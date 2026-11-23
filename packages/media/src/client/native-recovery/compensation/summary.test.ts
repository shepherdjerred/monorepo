import { describe, expect, it } from "vitest";
import { restorationSummary } from "./summary.ts";

const TRANSITION = "00000027-0000-4000-8000-000000000032";

function scope(entries: number, transitions: readonly string[] = [TRANSITION]) {
  const [first = TRANSITION, second = first, third = second] = transitions;
  return {
    transition: { transitionId: first },
    intent: { transitionId: second },
    interruptedWork: { transitionId: third },
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

  it("counts a scope that names two transitions as two upgrades, not as agreeing", () => {
    expect(
      restorationSummary(
        scope(3, [TRANSITION, "00000027-0000-4000-8000-000000000033"]),
      ),
    ).toEqual({ upgrades: 2, files: 3 });
  });
});
