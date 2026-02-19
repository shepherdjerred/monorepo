import type { Directory, Secret } from "@dagger.io/dagger";
import { ReturnType } from "@dagger.io/dagger";
import {
  getClaudeContainer,
  withClaudeAuth,
  withClaudeRun,
  executeClaudeRun,
  postBatchedReview,
  postComment,
  REVIEW_VERDICT_SCHEMA,
} from "./lib-claude.ts";
import { getGitHubContainer } from "./lib-github.ts";
import {
  REPO,
  REVIEW_PROMPT,
  REREVIEW_PREFIX,
  PR_ANALYSIS_SCHEMA,
  buildAnalysisScript,
  postErrorComment,
  parseVerdict,
  postApproval,
  postChangesRequested,
  type PrAnalysis,
  type InteractiveEventContext,
} from "./code-review-helpers.ts";


/**
 * Options for PR complexity analysis
 */
export type AnalyzePrComplexityOptions = {
  source: Directory;
  githubToken: Secret;
  prNumber: number;
  baseBranch: string;
  headSha: string;
};

/**
 * Analyzes PR complexity and review history.
 */
export async function analyzePrComplexity(
  options: AnalyzePrComplexityOptions,
): Promise<PrAnalysis> {
  const { source, githubToken, prNumber, baseBranch, headSha } = options;

  const analysisScript = buildAnalysisScript();

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
    throw new Error(
      `PR analysis script failed (exit ${String(exitCode)}): ${stderr.slice(0, 1000)}`,
    );
  }

  const result = await container.stdout();

  const parsed: unknown = JSON.parse(result);
  const validationResult = PR_ANALYSIS_SCHEMA.safeParse(parsed);
  if (!validationResult.success) {
    throw new TypeError(`Invalid PR analysis output: ${validationResult.error.message}`);
  }
  return validationResult.data;
}


/**
 * Options for reviewing a PR
 */
export type ReviewPrOptions = {
  source: Directory;
  githubToken: Secret;
  claudeOauthToken: Secret;
  prNumber: number;
  baseBranch: string;
  headSha: string;
};

/**
 * Full automatic review flow for a PR.
 */
export async function reviewPr(options: ReviewPrOptions): Promise<string> {
  const { source, githubToken, claudeOauthToken, prNumber, baseBranch, headSha } = options;

  const analysis = await analyzePrComplexity({ source, githubToken, prNumber, baseBranch, headSha });

  if (analysis.shouldSkip) {
    return handleSkippedPr(githubToken, prNumber, analysis);
  }

  const prompt = buildReviewPrompt(analysis);
  const execResult = await runClaudeReview({ source, githubToken, claudeOauthToken, prompt, maxTurns: analysis.maxTurns, prNumber });
  if (typeof execResult === "string") {
    return execResult;
  }

  const verdict = await parseVerdict(execResult.stdout, githubToken, prNumber);
  if (typeof verdict === "string") {
    return verdict;
  }

  const inlineCommentError = await postInlineComments(githubToken, prNumber, headSha, verdict);
  const inlineNote = inlineCommentError === undefined
    ? ""
    : `\n\n⚠️ Failed to post ${String(verdict.inline_comments.length)} inline comment(s): ${inlineCommentError.slice(0, 200)}`;

  if (verdict.should_approve) {
    return postApproval(githubToken, prNumber, verdict, inlineNote);
  }
  return postChangesRequested({ githubToken, prNumber, verdict, analysis, inlineNote });
}

/**
 * Handle a trivial PR that should be skipped.
 */
async function handleSkippedPr(
  githubToken: Secret,
  prNumber: number,
  analysis: PrAnalysis,
): Promise<string> {
  const skipMessage = `🤖 **Claude Code Review - Skipped**

This PR appears to be a trivial merge/rebase with minimal code changes (${String(analysis.totalChanges)} lines).

Automatic review skipped to save tokens. If you believe this should be reviewed, please:
1. Add a comment mentioning \`@claude\` to trigger interactive review, or
2. Add more substantive changes to trigger automatic review`;

  await postComment({
    githubToken,
    repository: REPO,
    prNumber,
    body: skipMessage,
  });

  return `Skipped trivial PR #${String(prNumber)} (${String(analysis.totalChanges)} lines, ${analysis.complexity})`;
}

/**
 * Build the review prompt with optional re-review prefix.
 */
function buildReviewPrompt(analysis: PrAnalysis): string {
  let prompt = "";
  if (analysis.isRereview && analysis.previousWasApproved) {
    prompt = REREVIEW_PREFIX;
  }
  prompt += REVIEW_PROMPT;
  return prompt;
}

type RunClaudeReviewOptions = {
  source: Directory;
  githubToken: Secret;
  claudeOauthToken: Secret;
  prompt: string;
  maxTurns: number;
  prNumber: number;
};

/**
 * Run Claude review and handle errors.
 * Returns the ExecResult on success or an error message string.
 */
async function runClaudeReview(
  options: RunClaudeReviewOptions,
): Promise<{ stdout: string; stderr: string; exitCode: number } | string> {
  const { source, githubToken, claudeOauthToken, prompt, maxTurns, prNumber } = options;
  let container = getClaudeContainer();
  container = withClaudeAuth(container, { claudeOauthToken });
  container = container
    .withMountedDirectory("/workspace", source)
    .withWorkdir("/workspace")
    .withSecretVariable("GH_TOKEN", githubToken);

  container = withClaudeRun(container, {
    prompt,
    model: "claude-opus-4-5-20251101",
    maxTurns,
    jsonSchema: REVIEW_VERDICT_SCHEMA,
  });

  try {
    const execResult = await executeClaudeRun(container);
    if (execResult.exitCode !== 0) {
      const errorDetail = execResult.stderr || execResult.stdout || "Unknown error";
      await postErrorComment(githubToken, prNumber, `Claude exited with code ${String(execResult.exitCode)}:\n\n${errorDetail.slice(0, 1000)}`);
      return `Review failed for PR #${String(prNumber)}: Claude exited with code ${String(execResult.exitCode)}`;
    }
    return execResult;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await postErrorComment(githubToken, prNumber, errorMessage.slice(0, 1000));
    return `Review failed for PR #${String(prNumber)}: ${errorMessage}`;
  }
}

/**
 * Post inline comments as a batched review.
 * Returns an error message string on failure, undefined on success.
 */
async function postInlineComments(
  githubToken: Secret,
  prNumber: number,
  headSha: string,
  verdict: { inline_comments: { path: string; line: number; side: "LEFT" | "RIGHT"; body: string }[] },
): Promise<string | undefined> {
  if (verdict.inline_comments.length === 0) {
    return undefined;
  }

  try {
    await postBatchedReview({
      githubToken,
      repository: REPO,
      prNumber,
      commitId: headSha,
      event: "COMMENT",
      body: "",
      comments: verdict.inline_comments,
    });
    return undefined;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Failed to post inline comments:", msg);
    return msg;
  }
}

/**
 * Options for interactive Claude response
 */
export type HandleInteractiveOptions = {
  source: Directory;
  githubToken: Secret;
  claudeOauthToken: Secret;
  prNumber: number;
  commentBody: string;
  eventContext?: InteractiveEventContext | undefined;
};

/**
 * Handle an interactive @claude mention in a PR comment.
 */
export async function handleInteractive(
  options: HandleInteractiveOptions,
): Promise<string> {
  const { source, githubToken, claudeOauthToken, prNumber, commentBody, eventContext } = options;

  await postAcknowledgment(githubToken, prNumber);

  const prompt = buildInteractivePrompt(commentBody, eventContext);
  const output = await runInteractiveClaude({ source, githubToken, claudeOauthToken, prompt, prNumber });
  if (typeof output !== "string") {
    return output.errorMessage;
  }

  return postInteractiveResponse(githubToken, prNumber, output);
}

/**
 * Post an acknowledgment comment.
 */
async function postAcknowledgment(githubToken: Secret, prNumber: number): Promise<void> {
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
}

/**
 * Build the prompt for interactive Claude requests.
 */
function buildInteractivePrompt(
  commentBody: string,
  eventContext?: InteractiveEventContext,
): string {
  let prompt = `Respond to this comment:\n\n${commentBody}\n\n`;

  if (eventContext?.path !== undefined) {
    prompt += `\nContext: This comment is on file \`${eventContext.path}\``;
    if (eventContext.line !== undefined && eventContext.line !== 0) {
      prompt += ` at line ${String(eventContext.line)}`;
    }
    if (eventContext.diffHunk !== undefined) {
      prompt += `\n\nDiff context:\n\`\`\`diff\n${eventContext.diffHunk}\n\`\`\``;
    }
    prompt += "\n";
  }

  prompt += "\nRead CLAUDE.md and relevant code for context. Be direct and concise.";
  return prompt;
}

type RunInteractiveClaudeOptions = {
  source: Directory;
  githubToken: Secret;
  claudeOauthToken: Secret;
  prompt: string;
  prNumber: number;
};

/**
 * Run Claude for interactive requests.
 * Returns the output string on success, or an object with errorMessage on failure.
 */
async function runInteractiveClaude(
  options: RunInteractiveClaudeOptions,
): Promise<string | { errorMessage: string }> {
  const { source, githubToken, claudeOauthToken, prompt, prNumber } = options;
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

  try {
    const execResult = await executeClaudeRun(container);

    if (execResult.exitCode !== 0) {
      const errorDetail = execResult.stderr || execResult.stdout || "Unknown error";
      await postErrorComment(githubToken, prNumber, `Claude exited with code ${String(execResult.exitCode)}:\n\n${errorDetail.slice(0, 1000)}`);
      return { errorMessage: `Interactive request failed for PR #${String(prNumber)}: Claude exited with code ${String(execResult.exitCode)}` };
    }

    return execResult.stdout;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await postErrorComment(githubToken, prNumber, errorMessage.slice(0, 1000));
    return { errorMessage: `Interactive request failed for PR #${String(prNumber)}: ${errorMessage}` };
  }
}

/**
 * Post the interactive response.
 */
async function postInteractiveResponse(
  githubToken: Secret,
  prNumber: number,
  output: string,
): Promise<string> {
  const maxLength = 64_000;
  const truncatedOutput = output.length > maxLength
    ? output.slice(0, maxLength) + "\n\n... (output truncated)"
    : output;

  try {
    await postComment({
      githubToken,
      repository: REPO,
      prNumber,
      body: truncatedOutput,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return `Failed to post response on PR #${String(prNumber)}: ${msg}`;
  }

  return `Responded to interactive request on PR #${String(prNumber)}`;
}
