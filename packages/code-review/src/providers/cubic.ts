import type { ReviewProvider } from "../types.ts";

export const CUBIC_LOGIN = "cubic-dev-ai";

/**
 * Strip leading whitespace and consecutive HTML comments (`<!-- ... -->`) from
 * the start of a Cubic review comment body in linear time.
 */
function stripLeadingHtmlComments(body: string): string {
  let rest = body.trimStart();
  while (rest.startsWith("<!--")) {
    const closeIndex = rest.indexOf("-->", 4);
    if (closeIndex === -1) {
      break;
    }
    rest = rest.slice(closeIndex + 3).trimStart();
  }
  return rest;
}

const CUBIC_PRIORITY_PREFIX_RE = /^P([0-3])\s*:/u;

/**
 * Cubic prefixes inline review thread bodies (optionally after leading HTML
 * metadata comments) with `P0:`, `P1:`, `P2:`, or `P3:`. Anchored to the start
 * after leading comments so `P1` buried mid-prose never matches.
 */
export function parseCubicSeverity(body: string | null): number | null {
  if (body === null) {
    return null;
  }
  const stripped = stripLeadingHtmlComments(body);
  const match = CUBIC_PRIORITY_PREFIX_RE.exec(stripped);
  return match?.[1] === undefined ? null : Number.parseInt(match[1], 10);
}

/**
 * Extract the headline from a Cubic inline review comment: strip leading HTML
 * comments and any `P[0-3]:` prefix, then return the first non-empty line
 * before `\n` or `<details>`.
 */
export function parseCubicFindingTitle(body: string | null): string | null {
  if (body === null) {
    return null;
  }
  const withoutComments = stripLeadingHtmlComments(body);
  const withoutSeverity = withoutComments.replace(/^P[0-3]\s*:\s*/u, "");
  const detailsIndex = withoutSeverity.search(/<details\b/iu);
  const candidate =
    detailsIndex === -1
      ? withoutSeverity
      : withoutSeverity.slice(0, detailsIndex);
  for (const rawLine of candidate.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line !== "") {
      return line;
    }
  }
  return null;
}

/**
 * Cubic (`cubic-dev-ai` GitHub App).
 *
 * Completion: Cubic always submits a `COMMENTED` PR review whose `commit_id`
 * equals the reviewed head commit, even on clean PRs
 * (`<!-- cubic:review-summary:start -->\n**No issues found**`), so
 * `cleanSignal: "none"` avoids false completions before the review lands.
 */
export const cubicProvider: ReviewProvider = {
  id: "cubic",
  displayName: "Cubic",
  startsReviewOnPush: false,
  botAuthoredPullRequestPolicy: "review",
  authorLogins: [CUBIC_LOGIN],
  parseSeverity: parseCubicSeverity,
  parseFindingTitle: parseCubicFindingTitle,
  findingKey: null,
  parseReviewBodyFindings: null,
  completion: {
    kind: "review-at-head",
    cleanSignal: "none",
  },
  detectSkip: {
    marker: "reviewable line",
    reasons: [{ match: "technical review maximum", reason: "too-many-files" }],
  },
  detectBlocked: [
    {
      matches: ["full reviewed-line capacity"],
      reason: "usage-limited",
      remediation: "Wait for Cubic reviewed-line capacity to reset",
    },
    {
      matches: ["public fair-use"],
      reason: "usage-limited",
      remediation: "Wait for Cubic public fair-use allowance to reset",
    },
    {
      matches: ["rate limit"],
      reason: "usage-limited",
      remediation: "Wait for Cubic rate limit to reset",
    },
  ],
  requestReview: { command: "@cubic-dev-ai review this PR" },
};
