import type { Secret } from "@dagger.io/dagger";
import {
  postReview,
  postComment,
  type ReviewVerdict,
} from "./lib-claude.ts";

export const REPO = "shepherdjerred/monorepo";

/**
 * Review prompt for Claude - focuses on things linters can't catch
 */
export const REVIEW_PROMPT = `Review this PR focusing on things linters and typecheckers can't catch:

- **Functionality**: Does the code actually do what the PR claims? Are requirements met?
- **Architectural fit**: Does this change fit the codebase patterns? Is it in the right place?
- **Logic errors**: Are there bugs, race conditions, or edge cases that could cause problems?
- **Security**: Any vulnerabilities that static analysis would miss?
- **Design**: Is this the right approach? Are there simpler alternatives?
- **Complexity**: Is the code over-engineered or hard to understand? Could it be simpler?
- **Performance**: Any bottlenecks, inefficient algorithms, or scalability concerns?
- **Error handling**: Are errors handled properly with useful error messages?
- **Logging & Observability**: Is there sufficient logging for debugging? Can you trace what happened when something goes wrong? Are log levels appropriate (error/warn/info/debug)?
- **Tests**: Are there appropriate tests? Do they cover edge cases, failure modes, and the happy path?
- **Commit messages**: Are they clear and explain "why"?

Read the CLAUDE.md file and explore related code to understand context. Be direct and concise - if something is fine, don't comment on it.

## Issue Severity Classification

Classify each issue you find:
- **Critical**: Security vulnerabilities, data loss risks, breaking changes
- **Major**: Logic errors, race conditions, architectural violations
- **Minor**: Suboptimal patterns, inconsistencies with conventions, in-scope improvements that could be addressed later
- **Nitpick**: ONLY for things truly outside the PR's scope:
  - Feature additions beyond what the PR aims to do
  - Pure style preferences with no functional impact
  - "Nice to have" suggestions unrelated to the PR's purpose
  - Documentation improvements for unrelated code

**Important**: If something is within the PR's scope and should be done (even if it could be deferred), classify it as Minor or higher, NOT as Nitpick. Nitpicks are reserved for genuinely out-of-scope suggestions.

## Inline Comments

For specific issues, include them in the inline_comments array in the JSON output with:
- path: file path relative to repo root
- line: line number
- side: "RIGHT" for additions (new code), "LEFT" for deletions
- body: your comment text

## Approval Decision

After your review, determine if this PR should be auto-approved:
- ✅ **Approve** if: Zero critical, major, AND minor issues (nitpicks only are acceptable)
- ❌ **Do not approve** if: ANY critical, major, or minor issues exist

Provide your decision in the structured output with issue counts and reasoning.`;

/**
 * Prefix for re-reviewing a previously approved PR
 */
export const REREVIEW_PREFIX = `## Re-Review Context

This PR was previously APPROVED. Focus your review on:
1. Changes since last approval (git diff of new commits)
2. Whether new changes introduce any regressions or issues
3. If no new issues: Keep reasoning BRIEF (1-2 sentences max)

**Important**: If the new changes look good, simply note "New changes maintain previous quality standards" and approve. No need to re-review unchanged code or repeat previous comments.

---

`;

/**
 * Analysis result from PR complexity check
 */
export type PrAnalysis = {
  shouldSkip: boolean;
  maxTurns: number;
  complexity: "empty" | "simple" | "medium" | "complex";
  isRereview: boolean;
  previousState: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "none";
  previousWasApproved: boolean;
  totalChanges: number;
  changedFiles: number;
};

/**
 * Event context for interactive comments (from review comments)
 */
export type InteractiveEventContext = {
  path?: string | undefined;
  line?: number | undefined;
  diffHunk?: string | undefined;
  inReplyToId?: number | undefined;
};

/**
 * Post an error comment on a PR, swallowing any notification failures.
 */
export async function postErrorComment(githubToken: Secret, prNumber: number, detail: string): Promise<void> {
  try {
    await postComment({
      githubToken,
      repository: REPO,
      prNumber,
      body: `🤖 **Claude Code Review - Error**\n\nAn error occurred during the review:\n\n\`\`\`\n${detail}\n\`\`\`\n\nPlease check the workflow logs for details.`,
    });
  } catch (notifyError) {
    console.error(
      "Failed to post error comment:",
      notifyError instanceof Error ? notifyError.message : String(notifyError),
    );
  }
}

/**
 * Parse and validate the structured verdict from Claude's output.
 * Returns the verdict or an error message string.
 */
export async function parseVerdict(stdout: string, githubToken: Secret, prNumber: number): Promise<ReviewVerdict | string> {
  try {
    const jsonMatch = /\{[\s\S]*"should_approve"[\s\S]*\}/.exec(stdout);
    if (!jsonMatch) {
      throw new Error("No valid JSON found in Claude output");
    }
    // eslint-disable-next-line custom-rules/no-type-assertions -- validated with runtime checks immediately after
    const verdict = JSON.parse(jsonMatch[0]) as ReviewVerdict;

    if (typeof verdict.should_approve !== "boolean") {
      throw new TypeError("Missing or invalid should_approve field");
    }
    if (typeof verdict.confidence !== "number") {
      throw new TypeError("Missing or invalid confidence field");
    }
    if (typeof verdict.issue_count.critical !== "number") {
      throw new TypeError("Missing or invalid issue_count field");
    }
    if (typeof verdict.reasoning !== "string") {
      throw new TypeError("Missing or invalid reasoning field");
    }
    if (!Array.isArray(verdict.inline_comments)) {
      verdict.inline_comments = [];
    }
    return verdict;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    try {
      await postComment({
        githubToken,
        repository: REPO,
        prNumber,
        body: `🤖 **Claude Code Review - Output Error**\n\nFailed to parse Claude's structured output:\n\n\`\`\`\n${errorMessage}\n\`\`\`\n\nRaw output (truncated):\n\`\`\`\n${stdout.slice(0, 500)}\n\`\`\``,
      });
    } catch (notifyError) {
      console.error(
        "Failed to post error comment:",
        notifyError instanceof Error ? notifyError.message : String(notifyError),
      );
    }
    return `Review output parsing failed for PR #${String(prNumber)}: ${errorMessage}`;
  }
}

/**
 * Post an approval review.
 */
export async function postApproval(
  githubToken: Secret,
  prNumber: number,
  verdict: ReviewVerdict,
  inlineNote: string,
): Promise<string> {
  const nitpickNote =
    verdict.issue_count.nitpick > 0
      ? `\n\n${String(verdict.issue_count.nitpick)} nitpick(s) noted in review comments are acceptable and don't block approval.`
      : "";

  try {
    await postReview({
      githubToken,
      repository: REPO,
      prNumber,
      action: "approve",
      body: `✅ **Automated approval by Claude Code Review**\n\nNo blocking issues found (confidence: ${String(verdict.confidence)}%).\n\n${verdict.reasoning}${nitpickNote}${inlineNote}`,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    try {
      await postComment({
        githubToken,
        repository: REPO,
        prNumber,
        body: `🤖 **Claude Code Review - Posting Error**\n\nFailed to submit review: ${msg.slice(0, 500)}\n\n**Verdict**: Approve (confidence: ${String(verdict.confidence)}%)\n\n${verdict.reasoning}`,
      });
    } catch (notifyError) {
      console.error("Failed to post fallback comment:", notifyError instanceof Error ? notifyError.message : String(notifyError));
    }
    return `Review posting failed for PR #${String(prNumber)}: ${msg}`;
  }
  return `Approved PR #${String(prNumber)} (confidence: ${String(verdict.confidence)}%)`;
}

/**
 * Post a changes-requested review.
 */
export async function postChangesRequested(
  githubToken: Secret,
  prNumber: number,
  verdict: ReviewVerdict,
  analysis: PrAnalysis,
  inlineNote: string,
): Promise<string> {
  const header = analysis.isRereview && analysis.previousWasApproved
    ? "⚠️ **Approval revoked - Changes requested**"
    : "❌ **Changes requested**";

  const context = analysis.isRereview && analysis.previousWasApproved
    ? "This PR was previously approved, but new changes introduce issues that need to be addressed."
    : "Issues found that need to be addressed before approval.";

  try {
    await postReview({
      githubToken,
      repository: REPO,
      prNumber,
      action: "request-changes",
      body: `${header}\n\n${context}\n\n**Issues found:**\n- Critical: ${String(verdict.issue_count.critical)}\n- Major: ${String(verdict.issue_count.major)}\n- Minor: ${String(verdict.issue_count.minor)}\n\n${verdict.reasoning}\n\nPlease review the inline comments and address the issues.${inlineNote}`,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    try {
      await postComment({
        githubToken,
        repository: REPO,
        prNumber,
        body: `🤖 **Claude Code Review - Posting Error**\n\nFailed to submit review: ${msg.slice(0, 500)}\n\n**Verdict**: Changes Requested\n\n**Issues found:**\n- Critical: ${String(verdict.issue_count.critical)}\n- Major: ${String(verdict.issue_count.major)}\n- Minor: ${String(verdict.issue_count.minor)}\n\n${verdict.reasoning}`,
      });
    } catch (notifyError) {
      console.error("Failed to post fallback comment:", notifyError instanceof Error ? notifyError.message : String(notifyError));
    }
    return `Review posting failed for PR #${String(prNumber)}: ${msg}`;
  }
  return `Requested changes on PR #${String(prNumber)} (critical: ${String(verdict.issue_count.critical)}, major: ${String(verdict.issue_count.major)}, minor: ${String(verdict.issue_count.minor)})`;
}
