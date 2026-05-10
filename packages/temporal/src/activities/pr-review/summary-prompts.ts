import type Anthropic from "@anthropic-ai/sdk";
import type { PrSummaryInput } from "#shared/schemas.ts";

/**
 * Hidden marker embedded in the SDK-native PR summary comment body. The
 * comment helper uses this to find and edit the existing summary in place
 * on subsequent pushes instead of leaving a fresh one each time.
 *
 * Deliberately distinct from the legacy `claude -p` summary's
 * `<!-- pr-summary -->` marker: during shadow mode both summaries run on
 * every non-draft PR so reviewers and the eval grader can compare quality
 * side-by-side. If the marker collided, one path's upsert would race the
 * other and we'd lose one of the two summaries. Phase 13 retires the
 * legacy path; at that point this marker can stay or revert to
 * `<!-- pr-summary -->`.
 */
export const SUMMARY_MARKER = "<!-- pr-summary-sdk -->";

const SYSTEM_PREAMBLE = `\
You are a senior staff engineer writing a concise pull request summary for a
TypeScript / Bun monorepo. You will be given the PR's diff, title, refs, and
repository conventions. Produce exactly one comment body and nothing else.

Output format (strict — required for downstream tooling to find and update the
comment in place across subsequent pushes):

${SUMMARY_MARKER}

<one-paragraph "Why" / motivation — 1 to 3 sentences explaining the change
intent. No "this PR" filler. No marketing language. No emojis.>

**What changed**
- <bulleted "What changed" list — group by package/module when more than ~5
  files. Each bullet is one line. Skip generated/lockfile noise.>

**Risk**
<short paragraph or bullets calling out anything that needs careful review:
auth changes, migrations, infra changes, breaking API shape changes, secret
handling. Omit the entire "Risk" section heading and body if there is nothing
notable to call out.>

Hard rules:
- Keep the comment under ~250 words total.
- Cite file paths from the diff. Never invent paths.
- Never claim a behavior the diff doesn't show.
- Output only the comment body. Do not wrap in code fences. Do not add prose
  before the marker line.`;

const REPO_CONVENTIONS_PREAMBLE = `\
# Repository conventions

The following conventions are stable across the repo. Use them to inform the
"Risk" section — for example, dependency-version changes route through Renovate
and migrations involving Prisma touch \`packages/birmel\` or
\`packages/scout-for-lol\`.`;

/** Build the per-PR user message that pairs with the cacheable system block. */
export function buildSummaryUserPrompt(input: {
  pr: PrSummaryInput;
  diff: string;
}): string {
  const { pr, diff } = input;
  return `\
# Pull request

- Repository: \`${pr.owner}/${pr.repo}\`
- Number: #${String(pr.prNumber)}
- Title: ${pr.prTitle}
- Author: @${pr.prAuthor}
- Base: \`${pr.baseRef}\`
- Head: \`${pr.headRef}\`
- Commit: \`${pr.commitSha}\`

# Diff

\`\`\`diff
${diff}
\`\`\`

Write the summary comment body now, starting with the \`${SUMMARY_MARKER}\` line.`;
}

/**
 * Build the Anthropic Messages API `system` content blocks. Two blocks: a
 * stable instructional preamble (volatile only when we tune the prompt) and
 * a repo-conventions block (volatile only when CLAUDE.md hierarchy shifts).
 *
 * The caller pins `cache_control: {type: "ephemeral"}` on the LAST block,
 * which auto-caches the entire prefix (preamble + conventions). Render order
 * is `tools` → `system` → `messages`, so the cache covers everything up to
 * (but not including) the per-PR user message — exactly what we want.
 */
export function buildSummarySystemBlocks(input: {
  repoConventionsMarkdown: string;
}): Anthropic.TextBlockParam[] {
  return [
    { type: "text", text: SYSTEM_PREAMBLE },
    {
      type: "text",
      text: `${REPO_CONVENTIONS_PREAMBLE}\n\n${input.repoConventionsMarkdown}`,
      cache_control: { type: "ephemeral" },
    },
  ];
}
