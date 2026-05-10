import { withSpan } from "#observability/tracing.ts";
import type { Finding } from "#shared/pr-review/finding.ts";

const COMPONENT = "pr-review-pipeline";

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({
      level,
      msg: message,
      component: COMPONENT,
      activity: "verifyFindings",
      ...fields,
    }),
  );
}

async function verifyFindingsImpl(findings: Finding[]): Promise<Finding[]> {
  return await withSpan(
    "prReview.verifyFindings",
    {
      "findings.input": findings.length,
    },
    () => {
      // Phase 1: stub passthrough. Real implementation runs the verifier
      // declared on each finding (typecheck/eslint/grep/test) in a sandboxed
      // Dagger container against PR head, drops contradicted findings, and
      // flags verified ones. Tracked in Phase 4 of the SOTA plan.
      jsonLog("info", "verifyFindings stub invoked", {
        inputCount: findings.length,
      });
      return Promise.resolve(findings);
    },
  );
}

export type VerifyActivities = typeof verifyActivities;

export const verifyActivities = {
  async prReviewVerify(findings: Finding[]): Promise<Finding[]> {
    return verifyFindingsImpl(findings);
  },
};
