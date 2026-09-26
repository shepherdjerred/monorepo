import type {
  ReviewProvider,
  ReviewThread,
  UnattributedBodyFinding,
} from "../types.ts";

/**
 * CodeRabbit (`coderabbitai` GitHub app) — reviewed this repository May 2026
 * (PRs #915–#924), then removed dashboard-side; no repo config ever existed.
 *
 * Completion: CodeRabbit posts a `COMMENTED` PR review per reviewed commit and
 * re-reviews on push, like Codex — but unlike Codex it always posts a review
 * object (even a nitpick-only one, PR #918), so a missing review means "not
 * reviewed yet" and there is no clean signal to declare.
 *
 * Findings live on two surfaces with identical badge markup: addressable
 * inline threads, and "outside diff range" sections in the review body for
 * findings the platform would not let it post inline. Nitpick sections carry
 * no severity badge and never block. The walkthrough, pre-merge checks, and
 * rate-limit notices live in issue comments and are never findings.
 */

export const CODERABBIT_LOGIN = "coderabbitai";

/**
 * A finding's badge line, inline or in a review body:
 *   `_⚠️ Potential issue_ | _🟠 Major_ | _⚡ Quick win_`
 *   `` `57-60`: _⚠️ Potential issue_ | _🟡 Minor_ | _⚡ Quick win_ ``
 * Nitpick lines (`` `5-11`: _⚡ Quick win_ ``) carry no severity and parse to
 * null. The emoji+level pair is the whole matcher: bare words like "Major" in
 * prose must not count.
 */
const CODERABBIT_SEVERITY_RE = /_(?:🔴\s*Critical|🟠\s*Major|🟡\s*Minor)_/u;

/** The bold title on the line after the badge line. */
const CODERABBIT_TITLE_RE = /\*\*([^*]+)\*\*/u;

/**
 * The start of one finding's badge line. The optional backticked line range
 * only appears in review bodies (inline threads already know their line).
 */
const CODERABBIT_BADGE_LINE_RE =
  /^(?:`(\d+)(?:-\d+)?`:\s*)?_[^_\n]+_ \| _(🔴\s*Critical|🟠\s*Major|🟡\s*Minor)_/gmu;

/** A per-file section header: `<summary>path/to/file.ts (2)</summary>`. */
const CODERABBIT_FILE_SECTION_RE = /<summary>([^<>]*?) \(\d+\)<\/summary>/gu;

const CODERABBIT_PRIORITIES = new Map([
  ["🔴 Critical", 0],
  ["🟠 Major", 1],
  ["🟡 Minor", 2],
]);

export function parseCoderabbitSeverity(body: string | null): number | null {
  if (body === null) return null;
  const match = CODERABBIT_SEVERITY_RE.exec(body);
  if (match === null) return null;
  const badge = match[0].slice(1, -1);
  for (const [label, priority] of CODERABBIT_PRIORITIES) {
    if (badge.replaceAll(/\s+/gu, " ") === label) return priority;
  }
  return null;
}

/** The bold title after the badge line; null when the body renders none. */
export function parseCoderabbitFindingTitle(
  body: string | null,
): string | null {
  if (body === null) return null;
  const badgeIndex = body.search(/_\s*\|/u);
  const titleMatch = CODERABBIT_TITLE_RE.exec(
    badgeIndex === -1 ? body : body.slice(badgeIndex),
  );
  const title = titleMatch?.[1]?.trim();
  return title === undefined || title === "" ? null : title;
}

function normalizeFindingKeyPart(value: string): string {
  return value.toLowerCase().replaceAll(/\s+/gu, " ").trim();
}

/**
 * Collapse an inline thread with its review-body copy: same file plus same
 * headline. Line numbers stay out of the key — the body cites a range start
 * while the thread may be file-level — and a null path or title never merges.
 */
export function coderabbitFindingKey(thread: ReviewThread): string | null {
  if (thread.path === null || thread.title === null) return null;
  const path = normalizeFindingKeyPart(thread.path);
  const title = normalizeFindingKeyPart(thread.title);
  return path === "" || title === "" ? null : `${path}::${title}`;
}

type BodyChunk = {
  index: number;
  line: number | null;
  priority: number;
  title: string | null;
};

/** Split a review body at each badged finding's badge line. */
function splitBodyFindings(body: string): BodyChunk[] {
  const starts: { index: number; line: number | null; badge: string }[] = [];
  for (const match of body.matchAll(CODERABBIT_BADGE_LINE_RE)) {
    const badge = match[2];
    if (badge === undefined) continue;
    const priority = CODERABBIT_PRIORITIES.get(badge.replaceAll(/\s+/gu, " "));
    if (priority === undefined) continue;
    const line = match[1] === undefined ? null : Number.parseInt(match[1], 10);
    starts.push({
      index: match.index,
      line: Number.isInteger(line) ? line : null,
      badge,
    });
  }
  return starts.map((start, i) => {
    const end = starts[i + 1]?.index ?? body.length;
    const rawTitle = CODERABBIT_TITLE_RE.exec(
      body.slice(start.index, end),
    )?.[1]?.trim();
    return {
      index: start.index,
      line: start.line,
      priority: CODERABBIT_PRIORITIES.get(start.badge) ?? 2,
      title: rawTitle === undefined || rawTitle === "" ? null : rawTitle,
    };
  });
}

/** The file path of the nearest preceding per-file section header. */
function pathForChunk(body: string, chunkIndex: number): string | null {
  let path: string | null = null;
  for (const match of body.matchAll(CODERABBIT_FILE_SECTION_RE)) {
    if (match.index > chunkIndex) break;
    // Section headers also introduce prompt and summary blocks; only a
    // file-like header (a slash path) names a finding's file.
    const header = match[1]?.trim();
    path = header?.includes("/") === true ? header : null;
  }
  return path;
}

/**
 * Parse the badged findings out of provider review bodies. Nitpick sections
 * carry no severity badge, so the badge-anchored split skips them: they never
 * block and must not inflate finding counts. Attribution is the caller's job;
 * every thread here carries its review so ordinals stay in one space.
 */
export function parseCoderabbitReviewBodies(
  reviews: readonly {
    id: string;
    submittedAt: string | null;
    body: string | null;
  }[],
): UnattributedBodyFinding[] {
  const findings: UnattributedBodyFinding[] = [];
  for (const review of reviews) {
    if (review.body === null) continue;
    for (const chunk of splitBodyFindings(review.body)) {
      findings.push({
        thread: {
          authorLogin: CODERABBIT_LOGIN,
          isResolved: false,
          isOutdated: false,
          path: pathForChunk(review.body, chunk.index),
          line: chunk.line,
          url: null,
          priority: chunk.priority,
          title: chunk.title,
          threadId: null,
          commentId: null,
          raisedInReview: null,
        },
        reviewId: review.id,
        reviewSubmittedAt: review.submittedAt,
      });
    }
  }
  return findings;
}

export const coderabbitProvider: ReviewProvider = {
  id: "coderabbit",
  displayName: "CodeRabbit",
  startsReviewOnPush: true,
  // A renovate bot PR (#918) carries a CodeRabbit review, so bot-authored
  // pull requests are reviewable with no allowlist to maintain.
  botAuthoredPullRequestPolicy: "review",
  authorLogins: [CODERABBIT_LOGIN],
  parseSeverity: parseCoderabbitSeverity,
  parseFindingTitle: parseCoderabbitFindingTitle,
  findingKey: coderabbitFindingKey,
  parseReviewBodyFindings: parseCoderabbitReviewBodies,
  completion: { kind: "review-at-head", cleanSignal: "none" },
  detectSkip: null,
  // Hitting the plan's review or credit limit posts an issue comment instead
  // of a review (PRs #915/#921), so without this the gate polls to its
  // deadline on a head that will never be reviewed. The notice names both the
  // hourly refill and the exhausted organisation credits; either one means no
  // review happened for this head.
  detectBlocked: {
    matches: ["rate limited by coderabbit.ai", "Review limit reached"],
    reason: "usage-limited",
    remediation:
      "Wait for CodeRabbit review capacity to refill or add usage credits, then comment `@coderabbitai review`",
  },
  // Observed working on PR #924: a human `@coderabbitai review` comment draws
  // a "Review triggered" reply even when automatic reviews are paused.
  requestReview: { command: "@coderabbitai review" },
};
