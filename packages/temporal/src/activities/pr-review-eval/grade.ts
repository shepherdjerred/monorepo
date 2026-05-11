/**
 * Wraps the pure `grade()` function from
 * `#shared/pr-review/eval-fixture.ts` in a Temporal activity so the
 * nightly workflow can call it with retry + span coverage. Grading is
 * deterministic (cluster-key match + pattern check) so a retry on
 * transient failure is safe.
 */
import { withSpan } from "#observability/tracing.ts";
import {
  grade,
  type Fixture,
  type GradeResult,
} from "#shared/pr-review/eval-fixture.ts";
import type { Finding } from "#shared/pr-review/finding.ts";

export type GradeRunInput = {
  fixture: Fixture;
  postedFindings: Finding[];
};

async function gradeRunImpl(input: GradeRunInput): Promise<GradeResult> {
  return await withSpan(
    "prReviewEval.grade",
    {
      "fixture.id": input.fixture.id,
      "fixture.category": input.fixture.category,
      "findings.posted": input.postedFindings.length,
    },
    () => Promise.resolve(grade(input.fixture, input.postedFindings)),
  );
}

export type EvalGradeActivities = typeof evalGradeActivities;

export const evalGradeActivities = {
  async prReviewEvalGrade(input: GradeRunInput): Promise<GradeResult> {
    return gradeRunImpl(input);
  },
};
