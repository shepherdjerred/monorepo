/**
 * Pure formatting functions for CI check results.
 *
 * Extracted from ci.ts so they can be tested without the Dagger SDK.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CheckResult {
  label: string;
  status: "PASS" | "FAIL";
  error?: string;
}

// ---------------------------------------------------------------------------
// Pure helpers (testable without Dagger)
// ---------------------------------------------------------------------------

/** Format check results into a human-readable summary string. */
export function formatSummary(
  results: CheckResult[],
  hassTokenPresent: boolean,
): string {
  const lines: string[] = [];
  for (const r of results) {
    if (r.status === "FAIL") {
      lines.push(`FAIL  ${r.label}`);
    } else {
      lines.push(`PASS  ${r.label}`);
    }
  }

  if (!hassTokenPresent) {
    lines.push("SKIP  homelab/ha (no hassToken)");
  }

  return lines.join("\n");
}

/** Extract failures from results and build the error details string. */
export function formatFailureDetails(failures: CheckResult[]): string {
  return failures.map((f) => `--- ${f.label} ---\n${f.error}`).join("\n\n");
}
