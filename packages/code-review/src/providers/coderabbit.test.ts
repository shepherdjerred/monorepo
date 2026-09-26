/**
 * CodeRabbit provider tests. Fixtures are trimmed but structurally faithful to
 * live reviews on PRs #918, #922, and #924 (May 2026): the badge line always
 * leads, the bold title follows, and outside-diff findings carry the same
 * badges as inline threads.
 */

import { describe, expect, test } from "vitest";
import { matchesBlockedSignal } from "../github-blocked.ts";
import type { ReviewThread } from "../types.ts";
import {
  CODERABBIT_LOGIN,
  coderabbitProvider,
  parseCoderabbitReviewBodies,
  parseCoderabbitSeverity,
} from "./coderabbit.ts";

/** Inline thread first comment, PR #924 (trimmed prose). */
const INLINE_MAJOR =
  "_🛠️ Refactor suggestion_ | _🟠 Major_ | _⚡ Quick win_\n" +
  "\n" +
  "**Move completed plan to archive directory.**\n" +
  "\n" +
  'The status is marked as "Complete" and the work is being shipped in this PR.';

/** Outside-diff finding copied out of a review body, PR #922. */
const BODY_MINOR =
  "`57-60`: _⚠️ Potential issue_ | _🟡 Minor_ | _⚡ Quick win_\n" +
  "\n" +
  "**Add a closing written summary section.**";

/** Nitpick finding: no severity badge, PR #918 review body. */
const NITPICK =
  "`5-11`: _⚡ Quick win_\n" +
  "\n" +
  "**Add a local `check` script that runs `mise check`.**";

/** Rate-limit notice excerpt, PR #915 issue comment. */
const RATE_LIMITED =
  "<!-- This is an auto-generated comment: rate limited by coderabbit.ai -->\n" +
  "> [!WARNING]\n" +
  "> ## Review limit reached\n" +
  "> `@shepherdjerred`, we couldn't start this review because you've used your available PR reviews for now.\n" +
  "> Your organization has run out of usage credits.";

/** Review body with one outside-diff finding and one nitpick section. */
const REVIEW_BODY_WITH_OUTSIDE_DIFF =
  "**Actionable comments posted: 1**\n" +
  "\n" +
  "> [!CAUTION]\n" +
  "> Some comments are outside the diff and can't be posted inline due to platform limitations.\n" +
  "<details>\n" +
  "<summary>⚠️ Outside diff range comments (1)</summary><blockquote>\n" +
  "<details>\n" +
  "<summary>packages/docs/logs/2026-05-24_scout-app-imagepullbackoff.md (1)</summary><blockquote>\n" +
  "\n" +
  `${BODY_MINOR}\n` +
  "\n" +
  "</blockquote></details>\n" +
  "</blockquote></details>\n" +
  "<details>\n" +
  "<summary>🧹 Nitpick comments (1)</summary>\n" +
  "<blockquote>\n" +
  "<details>\n" +
  "<summary>packages/scout-for-lol/packages/app/package.json (1)</summary>\n" +
  "<blockquote>\n" +
  "\n" +
  `${NITPICK}\n` +
  "\n" +
  "</blockquote></details>\n";

/** Nitpick-only review body, PR #918: no actionable header at all. */
const NITPICK_ONLY_BODY =
  "\n" +
  "\n" +
  "<details>\n" +
  "<summary>🧹 Nitpick comments (1)</summary>\n" +
  "<blockquote>\n" +
  "<details>\n" +
  "<summary>packages/scout-for-lol/packages/app/package.json (1)</summary>\n" +
  "<blockquote>\n" +
  "\n" +
  `${NITPICK}\n` +
  "\n" +
  "</blockquote></details>\n";

describe("parseCoderabbitSeverity", () => {
  test("maps the observed Major and Minor badges", () => {
    expect(parseCoderabbitSeverity(INLINE_MAJOR)).toBe(1);
    expect(parseCoderabbitSeverity(BODY_MINOR)).toBe(2);
  });

  test("maps Critical to P0 when it appears", () => {
    expect(
      parseCoderabbitSeverity(
        "_⚠️ Potential issue_ | _🔴 Critical_ | _⚡ Quick win_",
      ),
    ).toBe(0);
  });

  test("returns null for nitpicks, rate-limit notices, and prose", () => {
    expect(parseCoderabbitSeverity(NITPICK)).toBeNull();
    expect(parseCoderabbitSeverity(RATE_LIMITED)).toBeNull();
    expect(
      parseCoderabbitSeverity("a plain comment about Major work"),
    ).toBeNull();
    expect(parseCoderabbitSeverity(null)).toBeNull();
  });
});

describe("parseCoderabbitReviewBodies", () => {
  test("emits outside-diff findings with path, line, title, and priority", () => {
    const findings = parseCoderabbitReviewBodies([
      {
        id: "review-1",
        submittedAt: "2026-05-24T19:03:46Z",
        body: REVIEW_BODY_WITH_OUTSIDE_DIFF,
      },
    ]);
    expect(findings).toHaveLength(1);
    const finding = findings[0];
    expect(finding?.reviewId).toBe("review-1");
    expect(finding?.reviewSubmittedAt).toBe("2026-05-24T19:03:46Z");
    expect(finding?.thread.path).toBe(
      "packages/docs/logs/2026-05-24_scout-app-imagepullbackoff.md",
    );
    expect(finding?.thread.line).toBe(57);
    expect(finding?.thread.priority).toBe(2);
    expect(finding?.thread.title).toBe(
      "Add a closing written summary section.",
    );
    expect(finding?.thread.authorLogin).toBe(CODERABBIT_LOGIN);
    expect(finding?.thread.isResolved).toBe(false);
    expect(finding?.thread.isOutdated).toBe(false);
    expect(finding?.thread.threadId).toBeNull();
    expect(finding?.thread.commentId).toBeNull();
    expect(finding?.thread.raisedInReview).toBeNull();
  });

  test("emits nothing for nitpick-only bodies", () => {
    expect(
      parseCoderabbitReviewBodies([
        { id: "review-2", submittedAt: null, body: NITPICK_ONLY_BODY },
      ]),
    ).toEqual([]);
  });

  test("skips reviews with no body", () => {
    expect(
      parseCoderabbitReviewBodies([
        { id: "review-3", submittedAt: null, body: null },
      ]),
    ).toEqual([]);
  });
});

describe("coderabbitProvider", () => {
  test("declares the observed identity, completion, and triggers", () => {
    expect(coderabbitProvider.id).toBe("coderabbit");
    expect(coderabbitProvider.authorLogins).toEqual([CODERABBIT_LOGIN]);
    expect(coderabbitProvider.completion).toEqual({
      kind: "review-at-head",
      cleanSignal: "none",
    });
    expect(coderabbitProvider.requestReview).toEqual({
      command: "@coderabbitai review",
    });
    expect(coderabbitProvider.startsReviewOnPush).toBe(true);
    expect(coderabbitProvider.botAuthoredPullRequestPolicy).toBe("review");
    expect(coderabbitProvider.detectSkip).toBeNull();
  });

  test("titles match between an inline thread and its body copy", () => {
    const fromThread = coderabbitProvider.parseFindingTitle?.(INLINE_MAJOR);
    const fromBody = coderabbitProvider.parseFindingTitle?.(BODY_MINOR);
    expect(fromThread).toBe("Move completed plan to archive directory.");
    expect(fromBody).toBe("Add a closing written summary section.");
  });

  test("finding keys collapse an inline thread with its body copy", () => {
    const keyFor = coderabbitProvider.findingKey;
    expect(keyFor).not.toBeNull();
    const thread: ReviewThread = {
      authorLogin: CODERABBIT_LOGIN,
      isResolved: false,
      isOutdated: false,
      path: "packages/docs/plans/2026-05-24_ranked-report-designs.md",
      line: null,
      url: null,
      priority: 1,
      title: "Move completed plan to archive directory.",
      threadId: "thread-1",
      commentId: null,
      raisedInReview: null,
    };
    const bodyCopy: ReviewThread = { ...thread, threadId: null, url: null };
    expect(keyFor?.(thread)).toBe(keyFor?.(bodyCopy));
    expect(keyFor?.({ ...thread, title: "Something else entirely." })).not.toBe(
      keyFor?.(thread),
    );
    expect(keyFor?.({ ...thread, path: null })).toBeNull();
    expect(keyFor?.({ ...thread, title: null })).toBeNull();
  });

  test("detects the rate-limit notice as a usage block", () => {
    const blocked = coderabbitProvider.detectBlocked;
    expect(blocked).not.toBeNull();
    expect(blocked?.reason).toBe("usage-limited");
    expect(matchesBlockedSignal(blocked!, RATE_LIMITED)).toBe(true);
    expect(matchesBlockedSignal(blocked!, INLINE_MAJOR)).toBe(false);
  });
});
