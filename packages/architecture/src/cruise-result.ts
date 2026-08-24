import type { IRegularForbiddenRuleType } from "dependency-cruiser";
import { z } from "zod";

/**
 * The slice of dependency-cruiser's JSON report this package relies on.
 *
 * Parsing the JSON reporter rather than asking for a pre-rendered one is
 * deliberate: the rendered reporters give no module count, and without a module
 * count there is no way to tell a clean cruise from a cruise that inspected
 * nothing.
 */
const ViolationSchema = z.object({
  from: z.string(),
  to: z.string(),
  rule: z.object({ name: z.string(), severity: z.string() }),
  cycle: z.array(z.object({ name: z.string() })).optional(),
});

const CruiseReportSchema = z.object({
  summary: z.object({
    totalCruised: z.number().int().nonnegative(),
    error: z.number().int().nonnegative(),
    violations: z.array(ViolationSchema),
  }),
});

export type CruiseReport = z.output<typeof CruiseReportSchema>;
export type Violation = z.output<typeof ViolationSchema>;

export function parseCruiseReport(output: unknown): CruiseReport {
  if (typeof output !== "string") {
    throw new TypeError(
      "dependency-cruiser's JSON reporter returned a non-string result",
    );
  }
  return CruiseReportSchema.parse(JSON.parse(output));
}

/**
 * Render violations with the offending path *and* the reason the boundary
 * exists, so a failing build explains itself without a trip to the config.
 */
export function renderViolations(
  violations: readonly Violation[],
  rules: readonly IRegularForbiddenRuleType[],
): string {
  const comments = new Map(
    rules.map((rule) => [rule.name ?? "", rule.comment ?? ""]),
  );
  const lines: string[] = [];
  for (const violation of violations) {
    const path = violation.cycle
      ? [violation.from, ...violation.cycle.map((step) => step.name)].join(
          " -> ",
        )
      : `${violation.from} -> ${violation.to}`;
    lines.push(`  ${violation.rule.severity} ${violation.rule.name}: ${path}`);
    const comment = comments.get(violation.rule.name);
    if (comment !== undefined && comment !== "") {
      lines.push(`    ${comment}`);
    }
  }
  return lines.join("\n");
}
