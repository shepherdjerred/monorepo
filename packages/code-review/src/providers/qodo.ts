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
// Qodo posts this as its own comment once a re-review finishes, naming the
// commit it just read: "[Code review](…) by qodo was updated up to the latest
// commit https://github.com/<repo>/commit/<sha>".
const QODO_ACKNOWLEDGEMENT_MARKER = "was updated up to the latest commit";
// While a re-review runs, Qodo replaces the rendered review with a placeholder
// reading "New Review Started / This review has been superseded by a new
// analysis". It keeps the review heading but drops the finding-count header.
const QODO_IN_PROGRESS_MARKER = "<h3>New Review Started</h3>";
const QODO_DIVIDER_ALT = "Grey Divider";
const QODO_PREVIOUS_RESULTS_START = "<!-- FOLDED_SECTION_START -->";
const QODO_FINDING_COUNT_LABELS = [
  "Bugs",
  "Rule violations",
  "Requirement gaps",
  "UX issues",
  "Cross-repo conflicts",
  "Skill insights",
];

function declaredFindingCount(body: string): number {
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

/**
 * One rendered finding, the position Qodo numbered it with, and the identity
 * shared by its re-appended copies.
 */
type RenderedFinding = {
  number: number;
  identity: string;
  finding: ReviewThread;
};

/**
 * Blockquote markers opening a line, however deeply nested.
 *
 * Repeats the whole `>`-plus-optional-space unit rather than matching a run of
 * `>` characters: nesting is conventionally written `> >`, and a `>+` run stops
 * at the space between the levels, leaving the inner marker in the identity —
 * which is the very difference this exists to erase, one level down.
 *
 * Horizontal whitespace only, so a line's own marker is matched without
 * reaching into the line before it.
 */
const BLOCKQUOTE_MARKER = /^(?:[^\S\n]*>[^\S\n]?)+/gmu;

/**
 * Canonical form of a rendered finding, used to recognize the copies Qodo
 * re-appends. Qodo reflows the blockquote indentation of a finding's agent
 * prompt between copies, so whitespace carries no meaning here; everything
 * else — description, code link, evidence — is reproduced verbatim.
 */
function identityOf(summary: string, findingBody: string): string {
  const title = summary
    .replaceAll(/^\s*\d+\.\s*/gu, "")
    .replaceAll(/<\/?s>/giu, "")
    .replaceAll(/<code>\s*[✓☑][^<]*<\/code>/giu, "");
  return (
    `${title} ${findingBody}`
      // Evidence permalinks embed the commit Qodo read when it rendered that
      // copy, so two renderings of one finding differ by SHA alone. Keeping it
      // would make every re-review a brand-new finding and double the blocking
      // count on an unchanged PR — the exact accumulation this identity exists
      // to collapse.
      .replaceAll(/\b[0-9a-f]{40}\b/giu, "<commit>")
      // Blockquote markers are reflow, not content. Collapsing whitespace alone
      // leaves them behind, so one copy gaining a blank `>` continuation line —
      // which renders identically and says nothing — made the two copies
      // different findings, and the gate blocked on an unstruck duplicate of a
      // finding Qodo had already resolved. Stripped BEFORE the whitespace
      // collapse, which is the step that would otherwise weld a marker to the
      // text after it.
      .replaceAll(BLOCKQUOTE_MARKER, "")
      .replaceAll(/\s+/gu, "")
  );
}

/**
 * The finding's headline, as a reader would see it: the summary stripped of its
 * position, its resolved styling, and its category chips. Consumers that cannot
 * re-read the comment rely on this to say what the finding is.
 */
function findingTitle(summary: string): string {
  return summary
    .replaceAll(/<code>[^<]*<\/code>/giu, "")
    .replaceAll(/<[^>]*>/gu, "")
    .replace(/^\s*\d+\.\s*/u, "")
    .replaceAll(/[☑✓]/gu, "")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

/** Marks a finding resolved without changing what finding it is. */
export const QODO_RESOLVED_CHIP = "<code>☑ resolved</code>";

/**
 * Mark the finding titled `title` resolved, in place, in Qodo's review comment.
 *
 * Qodo does not strike a finding it has re-read and no longer reports — it
 * re-lists it verbatim — so an operator who has verified a finding is fixed or
 * wrong has no way to clear the gate except by editing this comment. The chip
 * form is load-bearing: `identityOf` strips `<code>☑ …</code>`, so writing the
 * marker as a chip resolves the finding WITHOUT forking its identity from the
 * copies Qodo re-appends on later reviews. A bare `☑` in the title would fork
 * it, leaving every earlier copy unresolved and still blocking.
 *
 * Returns the edited body, or null when no finding matches — callers must not
 * silently no-op an operator's dismissal.
 */
export function markQodoFindingResolved(
  body: string,
  title: string,
): string | null {
  const matches = [
    ...body.matchAll(/<summary>\s*\d+\.[\s\S]*?<\/summary>/giu),
  ].filter((match) =>
    (() => {
      const summary = match[0].slice("<summary>".length, -"</summary>".length);
      return findingTitle(summary) === title;
    })(),
  );
  // Two findings can share a headline. Editing the first would resolve one the
  // operator may not have verified and leave the other unreachable — worse, if
  // the first is already resolved this would report success having done
  // nothing. Refuse instead of guessing which one was meant.
  const unresolved = matches.filter(
    (match) => !match[0].includes("☑") && !/<s>[\s\S]*?<\/s>/iu.test(match[0]),
  );
  if (matches.length > 1 && unresolved.length !== 1) {
    throw new Error(
      `"${title}" matches ${String(matches.length)} findings in the review comment; ` +
        `resolve them from the PR instead so the right one is chosen deliberately.`,
    );
  }
  const match = unresolved[0] ?? matches[0];
  if (match === undefined) return null;
  const block = match[0];
  // Already resolved: report success rather than writing a second chip.
  if (block.includes("☑")) return body;
  const chipIndex = block.indexOf("<code>");
  const insertAt =
    chipIndex === -1 ? block.length - "</summary>".length : chipIndex;
  const edited =
    block.slice(0, insertAt) + `${QODO_RESOLVED_CHIP} ` + block.slice(insertAt);
  return (
    body.slice(0, match.index) + edited + body.slice(match.index + block.length)
  );
}

function parseSeveritySection(
  section: string,
  priority: 1 | 2 | 3,
  commentUrl: string | null,
): RenderedFinding[] {
  const findings: RenderedFinding[] = [];
  const summaries = [
    ...section.matchAll(/<summary>\s*\d+\.[\s\S]*?<\/summary>/giu),
  ];
  for (const [index, summaryMatch] of summaries.entries()) {
    const summary = summaryMatch[0].slice(
      "<summary>".length,
      -"</summary>".length,
    );
    const numberSeparatorIndex = summary.indexOf(".");
    if (numberSeparatorIndex <= 0) {
      throw new Error("Qodo finding summary could not be located");
    }
    const numberText = summary.slice(0, numberSeparatorIndex).trim();
    const nextSummaryIndex = summaries[index + 1]?.index ?? section.length;
    const bodyStart = summaryMatch.index + summaryMatch[0].length;
    // Qodo closes each finding with a rule. Stopping there keeps the container
    // markup between findings — the `<details>` wrapper that collapses a
    // tier's overflow, the tags that close the tier — out of the body, so two
    // renderings of one finding differ only where the finding itself does.
    const ruleIndex = section.indexOf("<hr/>", bodyStart);
    const findingBody = section.slice(
      bodyStart,
      ruleIndex === -1 || ruleIndex > nextSummaryIndex
        ? nextSummaryIndex
        : ruleIndex,
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
      number: Number.parseInt(numberText, 10),
      identity: identityOf(summary, findingBody),
      finding: {
        title: findingTitle(summary),
        authorLogin: QODO_LOGIN,
        isResolved: struck || checked,
        isOutdated: false,
        path,
        line: null,
        url: linkMatch?.[2] ?? commentUrl,
        priority,
      },
    });
  }
  // Count the findings this section opens, not just whether it opens any. The
  // section-level guard is satisfied by a single numbered finding, so without
  // this a finding whose summary markup changed shape parses to nothing while
  // its neighbours keep every other check green, and the gate passes having
  // never seen it. Counting openers stays inside the document: it never
  // reconciles against Qodo's header, which counts its own re-appended copies.
  const opened = countNumberedFindings(section);
  if (findings.length !== opened) {
    throw new Error(
      `Qodo P${String(priority)} section opens ${String(opened)} finding(s) ` +
        `but ${String(findings.length)} parsed`,
    );
  }
  return findings;
}

/**
 * Collapse the copies Qodo re-appends into the findings they describe.
 *
 * Qodo appends a fresh, unstruck copy of every finding on each re-review and
 * strikes through only the copy it resolved, so an unchanged PR accumulates
 * copies push after push and the gate's blocking count grows without any new
 * problem existing. Identical renderings in the same severity tier are one
 * finding, and Qodo's strike-through is its verdict on that finding rather
 * than on the one rendering it happened to mark.
 *
 * The tradeoff: a finding Qodo resolved and later re-reported verbatim reads
 * as resolved. Qodo re-reports it in the tier's newest copy while the struck
 * copy stays, so no rendering distinguishes that case — and preferring the
 * unstruck copy instead would leave every re-reviewed PR permanently blocked.
 */
function dedupeRenderedFindings(
  rendered: readonly RenderedFinding[],
): ReviewThread[] {
  const byIdentity = new Map<string, ReviewThread>();
  for (const { identity, finding } of rendered) {
    const key = `${String(finding.priority)} ${identity}`;
    const seen = byIdentity.get(key);
    if (seen === undefined) {
      byIdentity.set(key, finding);
      continue;
    }
    if (finding.isResolved) seen.isResolved = true;
  }
  return [...byIdentity.values()];
}

/** Qodo opens each finding with a numbered summary. */
const NUMBERED_FINDING_OPENER = /<summary>\s*\d+\./giu;

function countNumberedFindings(section: string): number {
  return [...section.matchAll(NUMBERED_FINDING_OPENER)].length;
}

function hasNumberedFinding(section: string): boolean {
  return countNumberedFindings(section) > 0;
}

/**
 * Qodo numbers the findings of each rendered review consecutively from 1, and
 * re-appends the whole review — renumbered from 1 again — on re-review, so the
 * numbering runs in blocks rather than across the comment. Within a block it is
 * a self-check the document carries: if drift reshaped one finding's markup past
 * recognition, the numbers the parser recovered skip the row it lost. Observed
 * on PR #2079, whose comment rendered findings 1-8 twice.
 *
 * This replaces reconciling the parsed rows against the header's category
 * totals. That total is not a usable bound in either direction — Qodo
 * re-appends a copy of every finding on re-review, so the rows can exceed it,
 * and PR #2079's own review comment declared `Bugs (10)` while rendering nine
 * bug rows, so they can also fall short with nothing hidden. Checking one
 * Qodo-authored aggregate against another cannot distinguish drift from Qodo
 * miscounting its own list; the numbering can.
 */
function assertContiguousNumbering(rendered: readonly RenderedFinding[]): void {
  let expected = 1;
  for (const { number } of rendered) {
    if (number === expected) {
      expected += 1;
      continue;
    }
    // A re-appended block restarts the numbering, so 1 is always a legal next
    // number; anything else means a row between them never parsed.
    if (number === 1) {
      expected = 2;
      continue;
    }
    throw new Error(
      `Qodo numbers each rendered review consecutively, so parsing must yield ` +
        `finding ${String(expected)} or a restart at 1; it yielded ` +
        `${String(number)} instead`,
    );
  }
}

/**
 * A finding opener that survives a change of wrapper tag. The strict parser
 * only recognizes `<summary>`; this recognizes the numbering itself wherever
 * Qodo renders it.
 */
const LOOSE_FINDING_OPENER =
  /<(?:summary|strong|b|p|h[1-6])[^>]*>\s*\d+\.\s/giu;

/**
 * Prove the parser reached every finding row the comment renders.
 *
 * Numbering alone cannot: if drift reshapes the row that ends a block, the
 * numbers that survive still run 1..n-1 and the next block legally restarts at
 * 1, so every other guard passes while that finding is silently dropped.
 * Counting the rows with a looser matcher than the one that parses them makes
 * the two independent — the strict parse is checked against markup the strict
 * parse cannot see — so a row that drifted out of the parser is still counted.
 * Counting rather than comparing numbers keeps this correct however many times
 * Qodo re-appends the review.
 */
function assertNoFindingBeyondParsed(
  reviewBody: string,
  rendered: readonly RenderedFinding[],
): void {
  const loose = [...reviewBody.matchAll(LOOSE_FINDING_OPENER)].length;
  if (loose > rendered.length) {
    throw new Error(
      `Qodo renders ${String(loose)} finding row(s) but only ` +
        `${String(rendered.length)} parsed`,
    );
  }
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

/**
 * The review Qodo rendered, from its first divider on and without the daily tip.
 *
 * Qodo closes every review with a "Tip of the day" block fenced by its own HTML
 * comments. That block is product chrome rather than review content, and it is
 * wrapped in `<details>` — which the clean-review check reads as proof the
 * comment renders findings. Left in, a review that genuinely found nothing looks
 * like one whose findings failed to parse, and the gate rejects the comment
 * instead of passing the PR. Removed before every layout check so the checks see
 * only what Qodo reviewed.
 */
const QODO_DAILY_TIP =
  /<!-- qodo-daily-tip:start -->[\s\S]*?<!-- qodo-daily-tip:end -->/giu;

/**
 * The current review, excluding Qodo's archived copies from older revisions.
 *
 * Qodo keeps previous results after a stable HTML marker. Those copies retain
 * their old unresolved styling even after the current review strikes through
 * the finding, and their prose can differ enough that content-based deduping
 * correctly treats them as distinct. They are history, not current findings,
 * so keep them outside every layout and gate decision.
 */
function currentReviewOf(body: string): string {
  const previousResultsIndex = body.indexOf(QODO_PREVIOUS_RESULTS_START);
  return previousResultsIndex === -1
    ? body
    : body.slice(0, previousResultsIndex);
}

function reviewBodyOf(body: string): string {
  return body
    .slice(body.indexOf(QODO_DIVIDER_ALT))
    .replaceAll(QODO_DAILY_TIP, "");
}

function assertParsedLayout(input: {
  body: string;
  expectedFindings: number;
  findings: readonly ReviewThread[];
  severitySections: number;
}): void {
  const reviewBody = reviewBodyOf(input.body);
  assertSectionsAreModelled(reviewBody);
  if (
    input.findings.length === 0 &&
    (input.expectedFindings !== 0 ||
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
  const currentReview = currentReviewOf(comment.body);
  const expectedFindings = declaredFindingCount(currentReview);
  const sections = currentReview.split(QODO_SECTION_SPLIT);
  const rendered: RenderedFinding[] = [];
  let severitySections = 0;

  for (const section of sections) {
    const priority = priorityForSection(section);
    if (priority === null) continue;
    severitySections += 1;
    rendered.push(...parseSeveritySection(section, priority, comment.url));
  }

  // Assert against the renderings, not the deduplicated findings: the layout
  // checks confirm the comment parsed as Qodo wrote it, and Qodo numbers every
  // copy it re-appends. Structure is checked before numbering so a recognizable
  // break reports itself rather than surfacing as the gap it leaves behind.
  assertParsedLayout({
    body: currentReview,
    expectedFindings,
    findings: rendered.map((entry) => entry.finding),
    severitySections,
  });
  assertContiguousNumbering(rendered);
  assertNoFindingBeyondParsed(reviewBodyOf(currentReview), rendered);

  return dedupeRenderedFindings(rendered);
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
  completion: {
    kind: "issue-comment",
    marker: QODO_REVIEW_MARKER,
    acknowledgement: { marker: QODO_ACKNOWLEDGEMENT_MARKER },
    inProgress: { marker: QODO_IN_PROGRESS_MARKER },
    parseFindings: parseQodoIssueComment,
  },
  detectSkip: null,
  requestReview: {
    buildComment: (marker) => `/review\n\n${marker}`,
  },
};
