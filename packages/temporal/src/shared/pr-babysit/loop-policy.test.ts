import { describe, expect, test } from "bun:test";
import {
  awaitingCiRegistration,
  awaitingRequiredChecks,
  decideNextAction,
  onlyPendingCi,
  type BudgetState,
} from "./loop-policy.ts";
import { failureSignature } from "./prompt.ts";
import {
  PrBabysitBudgetSchema,
  type BabysitVerdict,
  type CiVerdict,
  type ConflictVerdict,
  type PrState,
  type ReviewVerdict,
} from "./types.ts";

const GREEN_CI: CiVerdict = {
  green: true,
  failing: [],
  pending: [],
  ignoredSoft: [],
  noChecksReported: false,
  missingRequired: [],
};
const FAILING_CI: CiVerdict = {
  green: false,
  failing: ["buildkite/pr"],
  pending: [],
  ignoredSoft: [],
  noChecksReported: false,
  missingRequired: [],
};
const PENDING_CI: CiVerdict = {
  green: false,
  failing: [],
  pending: ["buildkite/pr"],
  ignoredSoft: [],
  noChecksReported: false,
  missingRequired: [],
};
const NO_CHECKS_CI: CiVerdict = {
  green: false,
  failing: [],
  pending: [],
  ignoredSoft: [],
  noChecksReported: true,
  missingRequired: [],
};
const MISSING_REQUIRED_CI: CiVerdict = {
  green: false,
  failing: [],
  pending: [],
  ignoredSoft: [],
  noChecksReported: false,
  missingRequired: ["buildkite/monorepo/pr/white-check-mark-ci-complete"],
};
const CLEAN: ConflictVerdict = { clean: true, paths: [], baseRef: "main" };
const RESOLVED: ReviewVerdict = {
  allResolved: true,
  blocking: [],
  advisory: [],
};

function verdict(over: {
  ci?: CiVerdict;
  conflicts?: ConflictVerdict;
  reviews?: ReviewVerdict;
  prState?: PrState;
  dodMet?: boolean;
}): BabysitVerdict {
  const ci = over.ci ?? GREEN_CI;
  const conflicts = over.conflicts ?? CLEAN;
  const reviews = over.reviews ?? RESOLVED;
  const prState = over.prState ?? "open";
  return {
    headSha: "abc123",
    prState,
    ci,
    conflicts,
    reviews,
    dodMet:
      over.dodMet ??
      (prState === "open" &&
        ci.green &&
        conflicts.clean &&
        reviews.allResolved),
    evaluatedAt: "2026-06-27T00:00:00.000Z",
  };
}

const budget = PrBabysitBudgetSchema.parse({});
const freshState: BudgetState = {
  iterationsTotal: 0,
  costUsd: 0,
  elapsedMinutes: 0,
  recentSignatures: [],
};

describe("decideNextAction", () => {
  test("done when DoD met", () => {
    expect(decideNextAction(verdict({}), budget, freshState).kind).toBe("done");
  });

  test("closed when PR merged", () => {
    expect(
      decideNextAction(verdict({ prState: "merged" }), budget, freshState).kind,
    ).toBe("closed");
  });

  test("act when CI failing", () => {
    expect(
      decideNextAction(verdict({ ci: FAILING_CI }), budget, freshState).kind,
    ).toBe("act");
  });

  test("wait when only CI pending", () => {
    expect(
      decideNextAction(verdict({ ci: PENDING_CI }), budget, freshState).kind,
    ).toBe("wait");
  });

  test("wait when no checks reported yet (fresh push, not green)", () => {
    const d = decideNextAction(
      verdict({ ci: NO_CHECKS_CI, dodMet: false }),
      budget,
      freshState,
    );
    expect(d.kind).toBe("wait");
    expect(d.reason).toContain("not reported");
  });

  test("standdown when max iterations reached", () => {
    const d = decideNextAction(verdict({ ci: FAILING_CI }), budget, {
      ...freshState,
      iterationsTotal: budget.maxIterations,
    });
    expect(d.kind).toBe("standdown");
    expect(d.reason).toContain("max iterations");
  });

  test("standdown when cost budget reached", () => {
    const d = decideNextAction(verdict({ ci: FAILING_CI }), budget, {
      ...freshState,
      costUsd: budget.maxCostUsd,
    });
    expect(d.kind).toBe("standdown");
    expect(d.reason).toContain("cost");
  });

  test("standdown when wall-clock budget reached", () => {
    const d = decideNextAction(verdict({ ci: FAILING_CI }), budget, {
      ...freshState,
      elapsedMinutes: budget.maxWallClockMinutes,
    });
    expect(d.kind).toBe("standdown");
    expect(d.reason).toContain("wall-clock");
  });

  test("standdown when stuck on the same failure", () => {
    const failing = verdict({ ci: FAILING_CI });
    const sig = failureSignature(failing);
    const d = decideNextAction(failing, budget, {
      ...freshState,
      recentSignatures: Array.from(
        { length: budget.stuckThreshold },
        () => sig,
      ),
    });
    expect(d.kind).toBe("standdown");
    expect(d.reason).toContain("stuck");
  });

  test("not stuck when failures differ", () => {
    const failing = verdict({ ci: FAILING_CI });
    const d = decideNextAction(failing, budget, {
      ...freshState,
      recentSignatures: ["ci:other-a", "ci:other-b"],
    });
    expect(d.kind).toBe("act");
  });
});

describe("onlyPendingCi", () => {
  test("true when pending CI is the only blocker", () => {
    expect(onlyPendingCi(verdict({ ci: PENDING_CI }))).toBe(true);
  });
  test("false when a real failure coexists", () => {
    expect(
      onlyPendingCi(
        verdict({
          ci: {
            green: false,
            failing: ["x"],
            pending: ["y"],
            ignoredSoft: [],
            noChecksReported: false,
            missingRequired: [],
          },
        }),
      ),
    ).toBe(false);
  });
});

describe("awaitingCiRegistration", () => {
  test("true when no checks reported and nothing else is actionable", () => {
    expect(awaitingCiRegistration(verdict({ ci: NO_CHECKS_CI }))).toBe(true);
  });
  test("false once checks are reported", () => {
    expect(awaitingCiRegistration(verdict({ ci: GREEN_CI }))).toBe(false);
    expect(awaitingCiRegistration(verdict({ ci: PENDING_CI }))).toBe(false);
  });
  test("false when a real failure coexists with no-checks flag", () => {
    expect(
      awaitingCiRegistration(
        verdict({
          ci: {
            green: false,
            failing: ["x"],
            pending: [],
            ignoredSoft: [],
            noChecksReported: true,
            missingRequired: [],
          },
        }),
      ),
    ).toBe(false);
  });
});

describe("awaitingRequiredChecks", () => {
  test("true when a required check has not registered/passed and nothing else is actionable", () => {
    expect(awaitingRequiredChecks(verdict({ ci: MISSING_REQUIRED_CI }))).toBe(
      true,
    );
  });
  test("false when no required checks are missing", () => {
    expect(awaitingRequiredChecks(verdict({ ci: GREEN_CI }))).toBe(false);
  });
  test("decideNextAction waits (does not act) on a missing required check", () => {
    const d = decideNextAction(
      verdict({ ci: MISSING_REQUIRED_CI }),
      budget,
      freshState,
    );
    expect(d.kind).toBe("wait");
  });
});
