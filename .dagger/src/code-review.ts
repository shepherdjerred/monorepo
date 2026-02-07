import type { Directory, Secret } from "@dagger.io/dagger";
import { ReturnType } from "@dagger.io/dagger";
import {
  getClaudeContainer,
  withClaudeAuth,
  withClaudeRun,
  executeClaudeRun,
  postReview,
  postBatchedReview,
  postComment,
  getGitHubContainer,
  REVIEW_VERDICT_SCHEMA,
  type ReviewVerdict,
} from "@shepherdjerred/dagger-utils/containers";
import type { ExecResult } from "@shepherdjerred/dagger-utils";

const REPO = "shepherdjerred/monorepo";

/**
 * Review prompt for Claude - focuses on things linters can't catch
 */
const REVIEW_PROMPT = `Review this PR focusing on things linters and typecheckers can't catch:

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
const REREVIEW_PREFIX = `## Re-Review Context

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
  /** Skip review entirely for trivial PRs */
  shouldSkip: boolean;
  /** Dynamic max turns based on PR size (10-30) */
  maxTurns: number;
  /** PR complexity classification */
  complexity: "empty" | "simple" | "medium" | "complex";
  /** Is this a re-review of an updated PR? */
  isRereview: boolean;
  /** Previous review state */
  previousState: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "none";
  /** Was the previous review an approval? */
  previousWasApproved: boolean;
  /** Total line changes */
  totalChanges: number;
  /** Number of files changed */
  changedFiles: number;
};

/**
 * Options for PR complexity analysis
 */
export type AnalyzePrComplexityOptions = {
  /** Source directory with git repo */
  source: Directory;
  /** GitHub token for API access */
  githubToken: Secret;
  /** PR number */
  prNumber: number;
  /** Base branch to compare against */
  baseBranch: string;
  /** Head commit SHA */
  headSha: string;
};

/**
 * Analyzes PR complexity and review history.
 * Runs a bash script inside a container to gather PR metadata.
 *
 * @param options - Analysis options
 * @returns PR analysis result
 */
export async function analyzePrComplexity(options: AnalyzePrComplexityOptions): Promise<PrAnalysis> {
  const { source, githubToken, prNumber, baseBranch, headSha } = options;

  // Build the analysis script - all debug output goes to stderr, only JSON to stdout
  const analysisScript = `#!/bin/bash
set -eu

# Parameters from environment
PR_NUMBER="\${PR_NUMBER}"
BASE_REF="\${BASE_REF}"
HEAD_SHA="\${HEAD_SHA}"

echo "Analyzing PR #\${PR_NUMBER}" >&2

# Fetch PR data
PR_DATA=$(gh api "repos/${REPO}/pulls/\${PR_NUMBER}")

ADDITIONS=$(echo "\$PR_DATA" | jq -r '.additions')
DELETIONS=$(echo "\$PR_DATA" | jq -r '.deletions')
CHANGED_FILES=$(echo "\$PR_DATA" | jq -r '.changed_files')
COMMITS=$(echo "\$PR_DATA" | jq -r '.commits')

echo "PR Metrics: +\${ADDITIONS} -\${DELETIONS}, \${CHANGED_FILES} files, \${COMMITS} commits" >&2

# Handle empty PR
if [ "\$COMMITS" -eq 0 ]; then
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

# Detect trivial PRs (merges/rebases)
COMMITS_DATA=$(gh api "repos/${REPO}/pulls/\${PR_NUMBER}/commits")
MERGE_COMMIT_COUNT=$(echo "\$COMMITS_DATA" | jq '[.[] | select(.parents | length >= 2)] | length')
TOTAL_COMMITS=$(echo "\$COMMITS_DATA" | jq 'length')

echo "Merge commits: \${MERGE_COMMIT_COUNT} / \${TOTAL_COMMITS}" >&2

# Try git diff for actual changes
ACTUAL_ADDITIONS="\$ADDITIONS"
ACTUAL_DELETIONS="\$DELETIONS"

git fetch origin "\${BASE_REF}" --depth=50 2>/dev/null || echo "Git fetch failed, using API stats" >&2

if DIFF_OUTPUT=$(git diff --shortstat "origin/\${BASE_REF}...\${HEAD_SHA}" 2>/dev/null); then
  if [ -n "\$DIFF_OUTPUT" ]; then
    ACTUAL_ADDITIONS=$(echo "\$DIFF_OUTPUT" | sed -n 's/.*\\([0-9][0-9]*\\) insertion.*/\\1/p')
    ACTUAL_DELETIONS=$(echo "\$DIFF_OUTPUT" | sed -n 's/.*\\([0-9][0-9]*\\) deletion.*/\\1/p')
    ACTUAL_ADDITIONS=\${ACTUAL_ADDITIONS:-0}
    ACTUAL_DELETIONS=\${ACTUAL_DELETIONS:-0}
    echo "Actual changes: +\${ACTUAL_ADDITIONS} -\${ACTUAL_DELETIONS}" >&2
  fi
fi

# Validate numeric values
if ! [[ "\$ACTUAL_ADDITIONS" =~ ^[0-9]+$ ]]; then ACTUAL_ADDITIONS="\$ADDITIONS"; fi
if ! [[ "\$ACTUAL_DELETIONS" =~ ^[0-9]+$ ]]; then ACTUAL_DELETIONS="\$DELETIONS"; fi

TOTAL_ACTUAL_CHANGES=\$((ACTUAL_ADDITIONS + ACTUAL_DELETIONS))

# Determine if PR should be skipped
SHOULD_SKIP=false

if [ "\$MERGE_COMMIT_COUNT" -eq "\$TOTAL_COMMITS" ] && [ "\$MERGE_COMMIT_COUNT" -gt 0 ]; then
  if [ "\$TOTAL_ACTUAL_CHANGES" -lt 50 ]; then
    echo "Trivial PR: Pure merge with <50 line changes" >&2
    SHOULD_SKIP=true
  fi
fi

if [ "\$ACTUAL_ADDITIONS" -eq 0 ] && [ "\$ACTUAL_DELETIONS" -eq 0 ]; then
  echo "Trivial PR: Pure rebase with 0 changes" >&2
  SHOULD_SKIP=true
fi

# Calculate complexity
TOTAL_CHANGES=\$((ADDITIONS + DELETIONS))
MAX_TURNS=35
COMPLEXITY="complex"

if [ "\$TOTAL_CHANGES" -lt 100 ] && [ "\$CHANGED_FILES" -lt 5 ]; then
  COMPLEXITY="simple"
elif [ "\$TOTAL_CHANGES" -lt 250 ] && [ "\$CHANGED_FILES" -lt 8 ]; then
  COMPLEXITY="medium"
fi

echo "Complexity: \${COMPLEXITY}, max_turns: \${MAX_TURNS}" >&2

# Check previous review status
REVIEWS=$(gh api "repos/${REPO}/pulls/\${PR_NUMBER}/reviews" --jq 'sort_by(.submitted_at) | reverse')
PREVIOUS_STATE=$(echo "\$REVIEWS" | jq -r '[.[] | select(.user.login == "github-actions[bot]")] | .[0].state // "none"')
PREVIOUS_WAS_APPROVED=false

if [ "\$PREVIOUS_STATE" = "APPROVED" ]; then
  PREVIOUS_WAS_APPROVED=true
fi

echo "Previous state: \${PREVIOUS_STATE}" >&2

# Check if re-review
IS_REREVIEW=false
if [ "\$PREVIOUS_STATE" != "none" ]; then
  LAST_REVIEW_COMMIT=$(echo "\$REVIEWS" | jq -r '[.[] | select(.user.login == "github-actions[bot]")] | .[0].commit_id // ""')
  if [ -n "\$LAST_REVIEW_COMMIT" ] && [ "\$LAST_REVIEW_COMMIT" != "null" ]; then
    if [ "\$LAST_REVIEW_COMMIT" != "\$HEAD_SHA" ]; then
      IS_REREVIEW=true
      echo "Re-review: new commits since last review" >&2
    fi
  fi
fi

# Output JSON
jq -n \\
  --argjson shouldSkip \$SHOULD_SKIP \\
  --argjson maxTurns \$MAX_TURNS \\
  --arg complexity "\$COMPLEXITY" \\
  --argjson isRereview \$IS_REREVIEW \\
  --arg previousState "\$PREVIOUS_STATE" \\
  --argjson previousWasApproved \$PREVIOUS_WAS_APPROVED \\
  --argjson totalChanges \$TOTAL_CHANGES \\
  --argjson changedFiles \$CHANGED_FILES \\
  '{shouldSkip: $shouldSkip, maxTurns: $maxTurns, complexity: $complexity, isRereview: $isRereview, previousState: $previousState, previousWasApproved: $previousWasApproved, totalChanges: $totalChanges, changedFiles: $changedFiles}'
`;

  // Run analysis in a container
  const container = getGitHubContainer()
    .withSecretVariable("GH_TOKEN", githubToken)
    .withMountedDirectory("/workspace", source)
    .withWorkdir("/workspace")
    .withEnvVariable("PR_NUMBER", prNumber.toString())
    .withEnvVariable("BASE_REF", baseBranch)
    .withEnvVariable("HEAD_SHA", headSha)
    .withNewFile("/tmp/analyze.sh", analysisScript)
    .withExec(["bash", "/tmp/analyze.sh"], { expect: ReturnType.Any });

  const exitCode = await container.exitCode();
  if (exitCode !== 0) {
    const stderr = await container.stderr();
    throw new Error(`PR analysis script failed (exit ${exitCode}): ${stderr.slice(0, 1000)}`);
  }

  const result = await container.stdout();

  // Parse JSON output
  const analysis = JSON.parse(result) as PrAnalysis;
  if (typeof analysis.shouldSkip !== "boolean" || typeof analysis.maxTurns !== "number") {
    throw new Error(`Invalid PR analysis output: ${result.slice(0, 500)}`);
  }
  return analysis;
}

/**
 * Options for reviewing a PR
 */
export type ReviewPrOptions = {
  /** Source directory with git repo */
  source: Directory;
  /** GitHub token for write operations (posting reviews) */
  githubToken: Secret;
  /** Claude OAuth token for Claude Code */
  claudeOauthToken: Secret;
  /** PR number */
  prNumber: number;
  /** Base branch */
  baseBranch: string;
  /** Head commit SHA */
  headSha: string;
};

/**
 * Full automatic review flow for a PR.
 *
 * @param options - Review options
 * @returns Review result message
 */
export async function reviewPr(options: ReviewPrOptions): Promise<string> {
  const { source, githubToken, claudeOauthToken, prNumber, baseBranch, headSha } = options;

  // Step 1: Analyze PR complexity
  const analysis = await analyzePrComplexity({
    source,
    githubToken,
    prNumber,
    baseBranch,
    headSha,
  });

  // Step 2: Skip trivial PRs
  if (analysis.shouldSkip) {
    const skipMessage = `🤖 **Claude Code Review - Skipped**

This PR appears to be a trivial merge/rebase with minimal code changes (${analysis.totalChanges} lines).

Automatic review skipped to save tokens. If you believe this should be reviewed, please:
1. Add a comment mentioning \`@claude\` to trigger interactive review, or
2. Add more substantive changes to trigger automatic review`;

    await postComment({
      githubToken,
      repository: REPO,
      prNumber,
      body: skipMessage,
    });

    return `Skipped trivial PR #${prNumber} (${analysis.totalChanges} lines, ${analysis.complexity})`;
  }

  // Step 3: Build prompt with re-review prefix if applicable
  let prompt = "";
  if (analysis.isRereview && analysis.previousWasApproved) {
    prompt = REREVIEW_PREFIX;
  }
  prompt += REVIEW_PROMPT;

  // Step 4: Run Claude review
  // Claude gets a read-only view via the source directory
  // We use a separate write token for posting reviews (security: token splitting)
  let container = getClaudeContainer();
  container = withClaudeAuth(container, { claudeOauthToken });
  container = container
    .withMountedDirectory("/workspace", source)
    .withWorkdir("/workspace")
    .withSecretVariable("GH_TOKEN", githubToken); // Read-only for Claude's exploration

  // withClaudeRun uses ReturnType.Any so we can capture exit code without throwing
  container = withClaudeRun(container, {
    prompt,
    model: "claude-opus-4-5-20251101",
    maxTurns: analysis.maxTurns,
    jsonSchema: REVIEW_VERDICT_SCHEMA,
  });

  let execResult: ExecResult;

  try {
    execResult = await executeClaudeRun(container);
  } catch (error) {
    // On failure, post a comment explaining what went wrong
    const errorMessage = error instanceof Error ? error.message : String(error);
    try {
      await postComment({
        githubToken,
        repository: REPO,
        prNumber,
        body: `🤖 **Claude Code Review - Error**

An error occurred during the review:

\`\`\`
${errorMessage.slice(0, 1000)}
\`\`\`

Please check the workflow logs for details.`,
      });
    } catch (notifyError) {
      console.error(
        "Failed to post error comment:",
        notifyError instanceof Error ? notifyError.message : String(notifyError),
      );
    }
    return `Review failed for PR #${prNumber}: ${errorMessage}`;
  }

  if (execResult.exitCode !== 0) {
    const errorDetail = execResult.stderr || execResult.stdout || "Unknown error";
    try {
      await postComment({
        githubToken,
        repository: REPO,
        prNumber,
        body: `🤖 **Claude Code Review - Error**

Claude exited with code ${execResult.exitCode}:

\`\`\`
${errorDetail.slice(0, 1000)}
\`\`\`

Please check the workflow logs for details.`,
      });
    } catch (notifyError) {
      console.error(
        "Failed to post error comment:",
        notifyError instanceof Error ? notifyError.message : String(notifyError),
      );
    }
    return `Review failed for PR #${prNumber}: Claude exited with code ${execResult.exitCode}`;
  }

  const stdout = execResult.stdout;

  // Step 5: Parse and validate structured output
  let verdict: ReviewVerdict;
  try {
    // Find JSON in the output (Claude may include other text)
    const jsonMatch = stdout.match(/\{[\s\S]*"should_approve"[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No valid JSON found in Claude output");
    }
    verdict = JSON.parse(jsonMatch[0]) as ReviewVerdict;

    // Validate required fields
    if (typeof verdict.should_approve !== "boolean") {
      throw new Error("Missing or invalid should_approve field");
    }
    if (typeof verdict.confidence !== "number") {
      throw new Error("Missing or invalid confidence field");
    }
    if (!verdict.issue_count || typeof verdict.issue_count.critical !== "number") {
      throw new Error("Missing or invalid issue_count field");
    }
    if (typeof verdict.reasoning !== "string") {
      throw new Error("Missing or invalid reasoning field");
    }
    // inline_comments is optional but should be an array if present
    if (!Array.isArray(verdict.inline_comments)) {
      verdict.inline_comments = [];
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    try {
      await postComment({
        githubToken,
        repository: REPO,
        prNumber,
        body: `🤖 **Claude Code Review - Output Error**

Failed to parse Claude's structured output:

\`\`\`
${errorMessage}
\`\`\`

Raw output (truncated):
\`\`\`
${stdout.slice(0, 500)}
\`\`\``,
      });
    } catch (notifyError) {
      console.error(
        "Failed to post error comment:",
        notifyError instanceof Error ? notifyError.message : String(notifyError),
      );
    }
    return `Review output parsing failed for PR #${prNumber}: ${errorMessage}`;
  }

  // Step 6: Post inline comments as batched review if any
  let inlineCommentError: string | undefined;
  if (verdict.inline_comments.length > 0) {
    try {
      await postBatchedReview({
        githubToken,
        repository: REPO,
        prNumber,
        commitId: headSha,
        event: "COMMENT", // Don't approve/request-changes here, do it separately
        body: "", // Body will be in the separate review
        comments: verdict.inline_comments,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("Failed to post inline comments:", msg);
      inlineCommentError = msg;
    }
  }

  const inlineNote = inlineCommentError
    ? `\n\n⚠️ Failed to post ${verdict.inline_comments.length} inline comment(s): ${inlineCommentError.slice(0, 200)}`
    : "";

  // Step 7: Post approve/request-changes
  if (verdict.should_approve) {
    const nitpickNote =
      verdict.issue_count.nitpick > 0
        ? `\n\n${verdict.issue_count.nitpick} nitpick(s) noted in review comments are acceptable and don't block approval.`
        : "";

    try {
      await postReview({
        githubToken,
        repository: REPO,
        prNumber,
        action: "approve",
        body: `✅ **Automated approval by Claude Code Review**

No blocking issues found (confidence: ${verdict.confidence}%).

${verdict.reasoning}${nitpickNote}${inlineNote}`,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      try {
        await postComment({
          githubToken,
          repository: REPO,
          prNumber,
          body: `🤖 **Claude Code Review - Posting Error**\n\nFailed to submit review: ${msg.slice(0, 500)}\n\n**Verdict**: Approve (confidence: ${verdict.confidence}%)\n\n${verdict.reasoning}`,
        });
      } catch (notifyError) {
        console.error(
          "Failed to post fallback comment:",
          notifyError instanceof Error ? notifyError.message : String(notifyError),
        );
      }
      return `Review posting failed for PR #${prNumber}: ${msg}`;
    }

    return `Approved PR #${prNumber} (confidence: ${verdict.confidence}%)`;
  } else {
    const header =
      analysis.isRereview && analysis.previousWasApproved
        ? "⚠️ **Approval revoked - Changes requested**"
        : "❌ **Changes requested**";

    const context =
      analysis.isRereview && analysis.previousWasApproved
        ? "This PR was previously approved, but new changes introduce issues that need to be addressed."
        : "Issues found that need to be addressed before approval.";

    try {
      await postReview({
        githubToken,
        repository: REPO,
        prNumber,
        action: "request-changes",
        body: `${header}

${context}

**Issues found:**
- Critical: ${verdict.issue_count.critical}
- Major: ${verdict.issue_count.major}
- Minor: ${verdict.issue_count.minor}

${verdict.reasoning}

Please review the inline comments and address the issues.${inlineNote}`,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      try {
        await postComment({
          githubToken,
          repository: REPO,
          prNumber,
          body: `🤖 **Claude Code Review - Posting Error**\n\nFailed to submit review: ${msg.slice(0, 500)}\n\n**Verdict**: Changes Requested\n\n**Issues found:**\n- Critical: ${verdict.issue_count.critical}\n- Major: ${verdict.issue_count.major}\n- Minor: ${verdict.issue_count.minor}\n\n${verdict.reasoning}`,
        });
      } catch (notifyError) {
        console.error(
          "Failed to post fallback comment:",
          notifyError instanceof Error ? notifyError.message : String(notifyError),
        );
      }
      return `Review posting failed for PR #${prNumber}: ${msg}`;
    }

    return `Requested changes on PR #${prNumber} (critical: ${verdict.issue_count.critical}, major: ${verdict.issue_count.major}, minor: ${verdict.issue_count.minor})`;
  }
}

/**
 * Event context for interactive comments (from review comments)
 */
export type InteractiveEventContext = {
  /** File path for review comments */
  path?: string | undefined;
  /** Line number for review comments */
  line?: number | undefined;
  /** Diff hunk context for review comments */
  diffHunk?: string | undefined;
  /** Reply-to comment ID for threaded replies */
  inReplyToId?: number | undefined;
};

/**
 * Options for interactive Claude response
 */
export type HandleInteractiveOptions = {
  /** Source directory with git repo */
  source: Directory;
  /** GitHub token for API access */
  githubToken: Secret;
  /** Claude OAuth token */
  claudeOauthToken: Secret;
  /** PR number */
  prNumber: number;
  /** Comment body (the @claude mention) */
  commentBody: string;
  /** Optional event context for review comments */
  eventContext?: InteractiveEventContext | undefined;
};

/**
 * Handle an interactive @claude mention in a PR comment.
 *
 * @param options - Interactive options
 * @returns Response message
 */
export async function handleInteractive(options: HandleInteractiveOptions): Promise<string> {
  const { source, githubToken, claudeOauthToken, prNumber, commentBody, eventContext } = options;

  // Step 1: Post acknowledgment
  try {
    await postComment({
      githubToken,
      repository: REPO,
      prNumber,
      body: "🤖 Processing your request...",
    });
  } catch (notifyError) {
    console.error(
      "Failed to post acknowledgment:",
      notifyError instanceof Error ? notifyError.message : String(notifyError),
    );
  }

  // Step 2: Build prompt with context
  let prompt = `Respond to this comment:\n\n${commentBody}\n\n`;

  if (eventContext?.path) {
    prompt += `\nContext: This comment is on file \`${eventContext.path}\``;
    if (eventContext.line) {
      prompt += ` at line ${eventContext.line}`;
    }
    if (eventContext.diffHunk) {
      prompt += `\n\nDiff context:\n\`\`\`diff\n${eventContext.diffHunk}\n\`\`\``;
    }
    prompt += "\n";
  }

  prompt += "\nRead CLAUDE.md and relevant code for context. Be direct and concise.";

  // Step 3: Run Claude
  let container = getClaudeContainer();
  container = withClaudeAuth(container, { claudeOauthToken });
  container = container
    .withMountedDirectory("/workspace", source)
    .withWorkdir("/workspace")
    .withSecretVariable("GH_TOKEN", githubToken);

  container = withClaudeRun(container, {
    prompt,
    model: "claude-opus-4-5-20251101",
    maxTurns: 35,
  });

  let output: string;
  try {
    const execResult = await executeClaudeRun(container);

    if (execResult.exitCode !== 0) {
      const errorDetail = execResult.stderr || execResult.stdout || "Unknown error";
      try {
        await postComment({
          githubToken,
          repository: REPO,
          prNumber,
          body: `🤖 **Error processing request**\n\nClaude exited with code ${execResult.exitCode}:\n\n\`\`\`\n${errorDetail.slice(0, 1000)}\n\`\`\``,
        });
      } catch (notifyError) {
        console.error(
          "Failed to post error comment:",
          notifyError instanceof Error ? notifyError.message : String(notifyError),
        );
      }
      return `Interactive request failed for PR #${prNumber}: Claude exited with code ${execResult.exitCode}`;
    }

    output = execResult.stdout;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    try {
      await postComment({
        githubToken,
        repository: REPO,
        prNumber,
        body: `🤖 **Error processing request**

\`\`\`
${errorMessage.slice(0, 1000)}
\`\`\``,
      });
    } catch (notifyError) {
      console.error(
        "Failed to post error comment:",
        notifyError instanceof Error ? notifyError.message : String(notifyError),
      );
    }
    return `Interactive request failed for PR #${prNumber}: ${errorMessage}`;
  }

  // Step 4: Truncate if needed (GitHub comment limit is ~65536 chars)
  const maxLength = 64000;
  if (output.length > maxLength) {
    output = output.slice(0, maxLength) + "\n\n... (output truncated)";
  }

  // Step 5: Post response
  try {
    await postComment({
      githubToken,
      repository: REPO,
      prNumber,
      body: output,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return `Failed to post response on PR #${prNumber}: ${msg}`;
  }

  return `Responded to interactive request on PR #${prNumber}`;
}
