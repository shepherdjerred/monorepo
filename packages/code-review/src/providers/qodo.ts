import type {
  ReviewIssueComment,
  ReviewProvider,
  ReviewThread,
} from "../types.ts";

const QODO_LOGIN = "qodo-code-review";
/**
 * Qodo ships several GitHub apps under the `qodo-ai` org and each posts under
 * its own login; this repository is reviewed by the free open-source app. Every
 * login is matched exactly (see identity.ts), so listing them cannot widen the
 * gate to a look-alike account.
 */
const QODO_AUTHOR_LOGINS = [
  QODO_LOGIN,
  "qodo-free-for-open-source-projects",
] as const;
const QODO_REVIEW_MARKER = "<h3>Code Review by Qodo</h3>";
const QODO_DIVIDER_ALT = "Grey Divider";
const QODO_FINDING_COUNT_LABELS = [
  "Bugs",
  "Rule violations",
  "Requirement gaps",
  "UX issues",
  "Cross-repo conflicts",
  "Skill insights",
];

function activeFindingCount(body: string): number {
  const markerIndex = body.indexOf(QODO_REVIEW_MARKER);
  const dividerIndex = body.indexOf(QODO_DIVIDER_ALT, markerIndex);
  if (markerIndex === -1 || dividerIndex === -1) {
    throw new Error("Qodo review comment is missing its finding-count header");
  }
  const header = body.slice(
    markerIndex + QODO_REVIEW_MARKER.length,
    dividerIndex,
  );
  const counts = new Map<string, number>();
  for (const match of header.matchAll(/<code>([^<]*)<\/code>/giu)) {
    const content = match[1]?.trim();
    if (content === undefined) continue;
    const countMatch = /\((\d+)\)$/u.exec(content);
    const countText = countMatch?.[1];
    if (countMatch === null || countText === undefined) continue;
    const labelText = content.slice(0, countMatch.index).trim();
    const label = QODO_FINDING_COUNT_LABELS.find((candidate) =>
      labelText.endsWith(candidate),
    );
    if (label === undefined) continue;
    if (counts.has(label)) {
      throw new Error(`Qodo review comment repeats the ${label} count`);
    }
    counts.set(label, Number.parseInt(countText, 10));
  }
  // Qodo renders only the categories it has something to report, so an absent
  // label means zero rather than drift. A header with no recognized label at
  // all is drift, and must not be read as a clean review.
  if (counts.size === 0) {
    throw new Error(
      "Qodo review comment declares no recognized finding counts",
    );
  }
  return [...counts.values()].reduce((total, count) => total + count, 0);
}

/**
 * Qodo renders three severity tiers. "Informational" is its optional tier and
 * maps to P3, so whether it blocks stays a policy choice made by
 * `REVIEW_MAX_BLOCKING_PRIORITY` rather than something this parser decides.
 * Every tier must be modelled: an unmodelled section still counts toward the
 * header total, so omitting one desynchronizes the declared-vs-parsed check.
 */
const QODO_SEVERITY_SECTIONS = [
  ["Action required", 1],
  ["Remediation recommended", 2],
  ["Informational", 3],
] as const;

const QODO_SECTION_SPLIT =
  /(?=<img[^>]+alt=["'](?:Action required|Remediation recommended|Informational)["'])/iu;

function priorityForSection(section: string): 1 | 2 | 3 | null {
  for (const [alt, priority] of QODO_SEVERITY_SECTIONS) {
    if (new RegExp(`alt=["']${alt}["']`, "iu").test(section)) return priority;
  }
  return null;
}

function parseSeveritySection(
  section: string,
  priority: 1 | 2 | 3,
  commentUrl: string | null,
): ReviewThread[] {
  const findings: ReviewThread[] = [];
  const summaries = [
    ...section.matchAll(/<summary>(\s*\d+\.[\s\S]*?)<\/summary>/giu),
  ];
  for (const [index, summaryMatch] of summaries.entries()) {
    const summary = summaryMatch[1];
    if (summary === undefined) {
      throw new Error("Qodo finding summary could not be located");
    }
    const nextSummaryIndex = summaries[index + 1]?.index ?? section.length;
    const findingBody = section.slice(
      summaryMatch.index + summaryMatch[0].length,
      nextSummaryIndex,
    );
    const struck = /<s>[\s\S]*?<\/s>/iu.test(summary);
    const checked = summary.includes("☑");
    const linkMatch =
      /<code>\[([^\n]+)\]\((https:\/\/github\.com\/[^)]+)\)<\/code>/iu.exec(
        findingBody,
      );
    const rawPath = linkMatch?.[1] ?? null;
    const path = rawPath?.replace(/\[R\d+(?:-\d+)?\]$/u, "") ?? null;
    findings.push({
      authorLogin: QODO_LOGIN,
      isResolved: struck || checked,
      isOutdated: false,
      path,
      line: null,
      url: linkMatch?.[2] ?? commentUrl,
      priority,
    });
  }
  return findings;
}

function hasNumberedFinding(section: string): boolean {
  return /<summary>\s*\d+\./iu.test(section);
}

/**
 * Guard the layout structurally rather than by arithmetic. Qodo's header total
 * is not reconcilable with its own list — it re-appends a fresh copy of every
 * finding on each re-review, so a comment can enumerate more findings than the
 * header counts. Comparing those two numbers means validating one Qodo-rendered
 * signal against another; these checks look at the document instead.
 */
function assertSectionsAreModelled(reviewBody: string): void {
  for (const section of reviewBody.split(/(?=<img[^>]+alt=["'][^"']*["'])/iu)) {
    const alt = /^<img[^>]+alt=["']([^"']*)["']/iu.exec(section)?.[1];
    if (alt === undefined) continue;
    const modelled = priorityForSection(section) !== null;
    if (!modelled && hasNumberedFinding(section)) {
      throw new Error(
        `Qodo review comment has findings under unmodelled severity section "${alt}"`,
      );
    }
    if (modelled && !hasNumberedFinding(section)) {
      throw new Error(
        `Qodo review comment severity section "${alt}" has no parseable findings`,
      );
    }
  }
}

function assertParsedLayout(input: {
  body: string;
  expectedActiveFindings: number;
  findings: readonly ReviewThread[];
  severitySections: number;
}): void {
  const activeFindings = input.findings.filter(
    (finding) => !finding.isResolved,
  ).length;
  // Never let a declared-but-unparseable review read as clean.
  if (activeFindings === 0 && input.expectedActiveFindings > 0) {
    throw new Error(
      `Qodo review comment declares ${input.expectedActiveFindings.toString()} active finding(s) ` +
        "but none were parsed",
    );
  }
  const reviewBody = input.body.slice(input.body.indexOf(QODO_DIVIDER_ALT));
  assertSectionsAreModelled(reviewBody);
  if (
    input.findings.length === 0 &&
    (input.expectedActiveFindings !== 0 ||
      input.severitySections !== 0 ||
      /<details>/iu.test(reviewBody))
  ) {
    throw new Error(
      "Qodo review comment did not match the finding or clean-review layout",
    );
  }
}

/**
 * Qodo's hosted GitHub integration keeps its review in one issue comment.
 * Findings under "Action required" are P1-equivalent; findings under
 * "Remediation recommended" are P2-equivalent. A checked or struck-through
 * finding is resolved in Qodo's persistent comment.
 */
export function parseQodoIssueComment(
  comment: ReviewIssueComment,
): readonly ReviewThread[] {
  const expectedActiveFindings = activeFindingCount(comment.body);
  const sections = comment.body.split(QODO_SECTION_SPLIT);
  const findings: ReviewThread[] = [];
  let severitySections = 0;

  for (const section of sections) {
    const priority = priorityForSection(section);
    if (priority === null) continue;
    severitySections += 1;
    findings.push(...parseSeveritySection(section, priority, comment.url));
  }

  assertParsedLayout({
    body: comment.body,
    expectedActiveFindings,
    findings,
    severitySections,
  });

  return findings;
}

function parseQodoSeverity(body: string | null): number | null {
  if (body === null) return null;
  if (/action required/iu.test(body)) return 1;
  if (/remediation recommended/iu.test(body)) return 2;
  if (/informational/iu.test(body)) return 3;
  return null;
}

export const qodoProvider: ReviewProvider = {
  id: "qodo",
  displayName: "Qodo",
  // Qodo skips bot-authored PRs by default (`ignore_bot_pr = true`). Keep the
  // gate's bot behavior explicit until Qodo is configured otherwise.
  botAuthoredPullRequestPolicy: "skip",
  authorLogins: QODO_AUTHOR_LOGINS,
  parseSeverity: parseQodoSeverity,
  completion: { kind: "issue-comment", marker: QODO_REVIEW_MARKER },
  parseIssueComment: parseQodoIssueComment,
  detectSkip: null,
  requestReview: {
    buildComment: (marker) => `/review\n\n${marker}`,
  },
};
