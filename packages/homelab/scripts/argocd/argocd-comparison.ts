import { z } from "zod";

/**
 * Conditions that mean Argo CD could not compare the desired state with the
 * live state. While one is present `managed-resources` is not a comparison of
 * the requested revision, so every finding derived from it is unproven.
 */
const COMPARISON_FAILURES = new Set(["ComparisonError", "InvalidSpecError"]);

const ComparisonStatusSchema = z
  .object({
    status: z
      .object({
        sync: z.object({ status: z.string().optional() }).loose().optional(),
        conditions: z
          .array(
            z
              .object({ type: z.string(), message: z.string().optional() })
              .loose(),
          )
          .optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

const MESSAGE_LIMIT = 600;

/**
 * Why an Application's comparison cannot back a safety decision, or nothing
 * when it can.
 *
 * The apply-safety preflight and every prune guard read `managed-resources`,
 * which Argo serves from its last comparison. When that comparison failed the
 * resource list describes no revision at all, and the checks built on it found
 * nothing to object to: on 2026-11-26 the media preflight recorded
 * "apply-safe" while Argo's own server-side dry-run rejected the qBittorrent
 * Deployment. An unproven comparison therefore refuses, naming Argo's reason,
 * instead of passing.
 */
export function comparisonFindings(
  appName: string,
  application: unknown,
): readonly string[] {
  const status = ComparisonStatusSchema.parse(application).status;
  const findings = (status?.conditions ?? [])
    .filter((condition) => COMPARISON_FAILURES.has(condition.type))
    .map(
      (condition) =>
        `${appName} has ${condition.type}; Argo could not compare the requested state, so its managed resources prove nothing: ${(condition.message ?? "no message").slice(0, MESSAGE_LIMIT)}`,
    );
  // Argo reports Unknown when it could not finish a comparison, sometimes
  // without a condition saying why.
  if (findings.length === 0 && status?.sync?.status === "Unknown")
    findings.push(
      `${appName} reports sync status Unknown; Argo has not completed a comparison to prove its managed resources against`,
    );
  return findings;
}
