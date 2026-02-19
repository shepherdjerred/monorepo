import type { Secret } from "@dagger.io/dagger";
import { z } from "zod";
import {
  postReview,
  postComment,
  type ReviewVerdict,
} from "./lib-claude.ts";

export const REPO = "shepherdjerred/monorepo";

/**
 * Zod schema for PR analysis output
 */
export const PR_ANALYSIS_SCHEMA = z.object({
  shouldSkip: z.boolean(),
  maxTurns: z.number(),
  complexity: z.enum(["empty", "simple", "medium", "complex"]),
  isRereview: z.boolean(),
  previousState: z.enum(["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "none"]),
  previousWasApproved: z.boolean(),
  totalChanges: z.number(),
  changedFiles: z.number(),
});

const INLINE_COMMENT_SCHEMA = z.object({
  path: z.string(),
  line: z.number(),
  side: z.enum(["LEFT", "RIGHT"]),
  body: z.string(),
});

const REVIEW_VERDICT_SCHEMA_ZOD = z.object({
  should_approve: z.boolean(),
  confidence: z.number(),
  issue_count: z.object({
    critical: z.number(),
    major: z.number(),
    minor: z.number(),
    nitpick: z.number(),
  }),
  reasoning: z.string(),
  inline_comments: z.array(INLINE_COMMENT_SCHEMA).default([]),
});

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
    const parsed: unknown = JSON.parse(jsonMatch[0]);
    const validationResult = REVIEW_VERDICT_SCHEMA_ZOD.safeParse(parsed);
    if (!validationResult.success) {
      throw new TypeError(`Invalid verdict: ${validationResult.error.message}`);
    }
    return validationResult.data;
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
type PostChangesRequestedOptions = {
  githubToken: Secret;
  prNumber: number;
  verdict: ReviewVerdict;
  analysis: PrAnalysis;
  inlineNote: string;
};

/**
 * Build the bash analysis script for PR complexity.
 */
export function buildAnalysisScript(): string {
  return `#!/bin/bash
set -eu

PR_NUMBER="\${PR_NUMBER}"
BASE_REF="\${BASE_REF}"
HEAD_SHA="\${HEAD_SHA}"

echo "Analyzing PR #\${PR_NUMBER}" >&2

PR_DATA=$(gh api "repos/${REPO}/pulls/\${PR_NUMBER}")

ADDITIONS=$(echo "$PR_DATA" | jq -r '.additions')
DELETIONS=$(echo "$PR_DATA" | jq -r '.deletions')
CHANGED_FILES=$(echo "$PR_DATA" | jq -r '.changed_files')
COMMITS=$(echo "$PR_DATA" | jq -r '.commits')

echo "PR Metrics: +\${ADDITIONS} -\${DELETIONS}, \${CHANGED_FILES} files, \${COMMITS} commits" >&2

if [ "$COMMITS" -eq 0 ]; then
  echo "PR has no commits" >&2
  jq -n \\
    --argjson shouldSkip true \\
    --argjson maxTurns 35 \\
    --arg complexity "empty" \\
    --argjson isRereview false \\
    --arg previousState "none" \\
    --argjson previousWasApproved false \\
    --argjson totalChanges 0 \\
    --argjson changedFiles 0 \\
    '{shouldSkip: $shouldSkip, maxTurns: $maxTurns, complexity: $complexity, isRereview: $isRereview, previousState: $previousState, previousWasApproved: $previousWasApproved, totalChanges: $totalChanges, changedFiles: $changedFiles}'
  exit 0
fi

COMMITS_DATA=$(gh api "repos/${REPO}/pulls/\${PR_NUMBER}/commits")
MERGE_COMMIT_COUNT=$(echo "$COMMITS_DATA" | jq '[.[] | select(.parents | length >= 2)] | length')
TOTAL_COMMITS=$(echo "$COMMITS_DATA" | jq 'length')

echo "Merge commits: \${MERGE_COMMIT_COUNT} / \${TOTAL_COMMITS}" >&2

ACTUAL_ADDITIONS="$ADDITIONS"
ACTUAL_DELETIONS="$DELETIONS"

git fetch origin "\${BASE_REF}" --depth=50 2>/dev/null || echo "Git fetch failed, using API stats" >&2

if DIFF_OUTPUT=$(git diff --shortstat "origin/\${BASE_REF}...\${HEAD_SHA}" 2>/dev/null); then
  if [ -n "$DIFF_OUTPUT" ]; then
    ACTUAL_ADDITIONS=$(echo "$DIFF_OUTPUT" | sed -n 's/.*\\([0-9][0-9]*\\) insertion.*/\\1/p')
    ACTUAL_DELETIONS=$(echo "$DIFF_OUTPUT" | sed -n 's/.*\\([0-9][0-9]*\\) deletion.*/\\1/p')
    ACTUAL_ADDITIONS=\${ACTUAL_ADDITIONS:-0}
    ACTUAL_DELETIONS=\${ACTUAL_DELETIONS:-0}
    echo "Actual changes: +\${ACTUAL_ADDITIONS} -\${ACTUAL_DELETIONS}" >&2
  fi
fi

if ! [[ "$ACTUAL_ADDITIONS" =~ ^[0-9]+$ ]]; then ACTUAL_ADDITIONS="$ADDITIONS"; fi
if ! [[ "$ACTUAL_DELETIONS" =~ ^[0-9]+$ ]]; then ACTUAL_DELETIONS="$DELETIONS"; fi

TOTAL_ACTUAL_CHANGES=$((ACTUAL_ADDITIONS + ACTUAL_DELETIONS))

SHOULD_SKIP=false

if [ "$MERGE_COMMIT_COUNT" -eq "$TOTAL_COMMITS" ] && [ "$MERGE_COMMIT_COUNT" -gt 0 ]; then
  if [ "$TOTAL_ACTUAL_CHANGES" -lt 50 ]; then
    echo "Trivial PR: Pure merge with <50 line changes" >&2
    SHOULD_SKIP=true
  fi
fi

if [ "$ACTUAL_ADDITIONS" -eq 0 ] && [ "$ACTUAL_DELETIONS" -eq 0 ]; then
  echo "Trivial PR: Pure rebase with 0 changes" >&2
  SHOULD_SKIP=true
fi

TOTAL_CHANGES=$((ADDITIONS + DELETIONS))
MAX_TURNS=35
COMPLEXITY="complex"

if [ "$TOTAL_CHANGES" -lt 100 ] && [ "$CHANGED_FILES" -lt 5 ]; then
  COMPLEXITY="simple"
elif [ "$TOTAL_CHANGES" -lt 250 ] && [ "$CHANGED_FILES" -lt 8 ]; then
  COMPLEXITY="medium"
fi

echo "Complexity: \${COMPLEXITY}, max_turns: \${MAX_TURNS}" >&2

REVIEWS=$(gh api "repos/${REPO}/pulls/\${PR_NUMBER}/reviews" --jq 'sort_by(.submitted_at) | reverse')
PREVIOUS_STATE=$(echo "$REVIEWS" | jq -r '[.[] | select(.user.login == "github-actions[bot]")] | .[0].state // "none"')
PREVIOUS_WAS_APPROVED=false

if [ "$PREVIOUS_STATE" = "APPROVED" ]; then
  PREVIOUS_WAS_APPROVED=true
fi

echo "Previous state: \${PREVIOUS_STATE}" >&2

IS_REREVIEW=false
if [ "$PREVIOUS_STATE" != "none" ]; then
  LAST_REVIEW_COMMIT=$(echo "$REVIEWS" | jq -r '[.[] | select(.user.login == "github-actions[bot]")] | .[0].commit_id // ""')
  if [ -n "$LAST_REVIEW_COMMIT" ] && [ "$LAST_REVIEW_COMMIT" != "null" ]; then
    if [ "$LAST_REVIEW_COMMIT" != "$HEAD_SHA" ]; then
      IS_REREVIEW=true
      echo "Re-review: new commits since last review" >&2
    fi
  fi
fi

jq -n \\
  --argjson shouldSkip $SHOULD_SKIP \\
  --argjson maxTurns $MAX_TURNS \\
  --arg complexity "$COMPLEXITY" \\
  --argjson isRereview $IS_REREVIEW \\
  --arg previousState "$PREVIOUS_STATE" \\
  --argjson previousWasApproved $PREVIOUS_WAS_APPROVED \\
  --argjson totalChanges $TOTAL_CHANGES \\
  --argjson changedFiles $CHANGED_FILES \\
  '{shouldSkip: $shouldSkip, maxTurns: $maxTurns, complexity: $complexity, isRereview: $isRereview, previousState: $previousState, previousWasApproved: $previousWasApproved, totalChanges: $totalChanges, changedFiles: $changedFiles}'
`;
}

export async function postChangesRequested(
  options: PostChangesRequestedOptions,
): Promise<string> {
  const { githubToken, prNumber, verdict, analysis, inlineNote } = options;
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
