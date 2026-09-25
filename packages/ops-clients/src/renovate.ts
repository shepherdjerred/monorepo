/**
 * Parser for the Renovate Dependency Dashboard issue body. Renovate marks each
 * actionable checkbox with an HTML comment such as
 * `<!-- approve-branch=renovate/foo -->`, followed by the PR title.
 */

export const DEPENDENCY_DASHBOARD_TITLE = "Dependency Dashboard";

export type RenovateUpdateState = "awaiting-approval" | "pending-checks";

export type RenovateUpdate = {
  state: RenovateUpdateState;
  branch: string;
  title: string;
};

export type DependencyDashboard = {
  updates: RenovateUpdate[];
  counts: Record<RenovateUpdateState, number>;
};

const MARKER_STATES: Record<string, RenovateUpdateState> = {
  "approve-branch": "awaiting-approval",
  "unpend-branch": "pending-checks",
};

const MARKER_PATTERN =
  /^\s*-\s*\[[ x]\]\s*<!--\s*(approve-branch|unpend-branch)=(\S+?)\s*-->(.*)$/gmu;

export function parseDependencyDashboard(body: string): DependencyDashboard {
  const updates: RenovateUpdate[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(MARKER_PATTERN)) {
    const [, marker, branch, rest] = match;
    const state = marker === undefined ? undefined : MARKER_STATES[marker];
    if (state === undefined || branch === undefined) {
      throw new Error(`Unrecognized Renovate marker in: ${match[0]}`);
    }
    const key = `${state}:${branch}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    updates.push({
      state,
      branch,
      title: (rest ?? "").trim() || branch,
    });
  }
  return {
    updates,
    counts: {
      "awaiting-approval": updates.filter(
        (u) => u.state === "awaiting-approval",
      ).length,
      "pending-checks": updates.filter((u) => u.state === "pending-checks")
        .length,
    },
  };
}

/** Whether a PR branch or author identifies a Renovate update. */
export function isRenovatePullRequest(input: {
  branch: string;
  authorLogin: string | undefined;
}): boolean {
  return (
    input.branch.startsWith("renovate/") ||
    (input.authorLogin !== undefined &&
      /^(?:app\/)?renovate(?:\[bot\])?$/u.test(input.authorLogin))
  );
}
