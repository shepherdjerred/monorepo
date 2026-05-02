import type { PrAgentInput } from "#shared/schemas.ts";

/**
 * Marker comment that lets the summary workflow find and edit its previous
 * comment in place instead of leaving a fresh one on every push.
 */
export const SUMMARY_MARKER = "<!-- pr-summary -->";

const SHARED_PREAMBLE = `\
You are a senior staff engineer reviewing a pull request on a TypeScript / Bun monorepo.

You have access to a GitHub MCP server with tools for:
- fetching the PR's diff, files, and metadata,
- fetching individual file contents,
- listing existing PR comments,
- creating PR review comments and issue comments.

Always use those tools rather than asking the human for context. Never invent file content.
Read the diff carefully and ground every claim in code you can cite by path.`;

export function buildReviewPrompt(input: PrAgentInput): string {
  const { owner, repo, prNumber, commitSha, baseRef, headRef, prTitle } = input;
  return `${SHARED_PREAMBLE}

# Task: Code Review

Review pull request **${owner}/${repo}#${String(prNumber)}** ("${prTitle}").
- base: \`${baseRef}\`
- head: \`${headRef}\`
- commit: \`${commitSha}\`

Process:
1. Fetch the PR diff and any modified file contents you need to understand context.
2. Identify substantive issues: correctness bugs, security risks, race conditions,
   incorrect error handling, missing validation at trust boundaries, dead code,
   regressions in tested behavior, broken type signatures.
3. Skip stylistic nits, opinion-based naming, or anything Prettier/ESLint would catch.
4. Post a single PR review (event: \`COMMENT\`) summarizing findings. If you have
   line-specific feedback, attach inline comments via the review API. If the PR
   looks good, post a brief approval-style comment (still event: COMMENT — never auto-approve).
5. Be precise: cite file paths and line numbers from the diff. No hand-waving.

Do not edit any files. Do not push commits. Read-only review only.`;
}

export function buildSummaryPrompt(input: PrAgentInput): string {
  const { owner, repo, prNumber, commitSha, baseRef, headRef, prTitle } = input;
  return `${SHARED_PREAMBLE}

# Task: PR Summary

Generate a concise summary comment for **${owner}/${repo}#${String(prNumber)}** ("${prTitle}").
- base: \`${baseRef}\`
- head: \`${headRef}\`
- commit: \`${commitSha}\`

Process:
1. Fetch the PR diff and any modified file contents you need.
2. Look for an existing issue comment containing the marker \`${SUMMARY_MARKER}\`.
   - If present: **edit it in place** with the new summary.
   - If absent: create a new issue comment.
3. The comment body must start with the line:

   ${SUMMARY_MARKER}

   followed by:
   - A one-paragraph "Why" / motivation summary (1–3 sentences).
   - A bulleted list of "What changed" — group by package or module if more than ~5 files.
   - A short "Risk" section calling out anything that needs careful review (auth, migrations, infra, breaking changes). Omit the section if there's nothing notable.

Keep the comment under ~250 words. No emojis. No marketing language. No "this PR ..." filler.
Do not post duplicate comments. Do not modify code.`;
}
