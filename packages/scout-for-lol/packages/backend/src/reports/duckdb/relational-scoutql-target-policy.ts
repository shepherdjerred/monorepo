function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].toSorted();
}

export function appendWallClockIssues(
  wallClockReferences: readonly string[],
  issues: string[],
): void {
  for (const wallClock of uniqueSorted(wallClockReferences)) {
    issues.push(
      `ScoutQL wall-clock reference ${wallClock} is not allowed; use immutable bound parameters.`,
    );
  }
}

export function appendTargetBindingIssues(input: {
  profile: "relational-v2" | "dare-sql-v3";
  targetKeys: readonly string[];
  allowedTargetKeys: ReadonlySet<string>;
  invalidTargetCalls: number;
  issues: string[];
}): void {
  const { profile, targetKeys, allowedTargetKeys, invalidTargetCalls, issues } =
    input;
  if (profile === "relational-v2" && invalidTargetCalls > 0) {
    issues.push(
      "Every dare_target(...) call must contain exactly one string literal target key.",
    );
  }
  if (targetKeys.length === 0) {
    issues.push(
      profile === "dare-sql-v3"
        ? "A Dare SQL contract must reference at least one target relation (T1 through T5)."
        : "A Dare contract query must bind at least one dare_target(...).",
    );
  }
  if (profile !== "dare-sql-v3") return;
  const hasAllTargets = [...allowedTargetKeys].every((key) =>
    targetKeys.includes(key),
  );
  if (!hasAllTargets || new Set(targetKeys).size !== allowedTargetKeys.size) {
    issues.push(
      "A Dare SQL contract must reference exactly the target relations frozen in its bindings.",
    );
  }
}

export function appendTimelineCoverageIssues(
  profile: "relational-v2" | "dare-sql-v3",
  physicalSources: readonly string[],
  issues: string[],
): void {
  if (profile !== "dare-sql-v3") return;
  const readsTimeline = physicalSources.some(
    (source) =>
      source.startsWith("timeline_") && source !== "timeline_coverage",
  );
  if (readsTimeline && !physicalSources.includes("timeline_coverage")) {
    issues.push(
      "Dare SQL that reads timeline rows must also read timeline_coverage so missing data cannot be treated as zero.",
    );
  }
}
