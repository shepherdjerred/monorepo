/**
 * Prompts for the docs-groom workflow. Kept as exported constants so they
 * are reviewable in one place and can be unit-tested if needed.
 *
 * Both prompts assume Claude is invoked via `claude -p --output-format json`
 * with `--allowed-tools "Read,Write,Edit,Glob,Grep,Bash(rg:*),Bash(bun:*)"`
 * and `--permission-mode acceptEdits`. The activities pass them as the sole
 * positional argument; no system prompt override.
 */

export const GROOM_PROMPT = `You are running as part of a daily automated grooming pass over the
\`packages/docs/\` directory of the shepherdjerred/monorepo. You are working
in a fresh git worktree on a feature branch off origin/main. You can read,
write, and edit files freely within the worktree.

# Authoritative conventions

Before doing anything else, read these two files and follow them strictly:
- \`packages/docs/CLAUDE.md\` — doc-system conventions
- \`packages/docs/index.md\` — the table of contents you must keep in sync

Key rules from CLAUDE.md you MUST respect:
- Naming: \`<yyyy-mm-dd>_kebab-case.md\`
- Categories: \`architecture/\`, \`patterns/\`, \`decisions/\`, \`guides/\`, \`plans/\`
- Plans must have a \`## Status\` section near the top
- Archive don't delete: outdated docs go to \`archive/<technology>/\` or \`archive/superseded/\`
- No root-level docs (every doc lives in a subdirectory)
- Update \`index.md\` after any moves, additions, or removals

# Your two responsibilities

## 1. DO the easy in-place grooming yourself

Edit files directly. Examples of what to do inline:
- Move stale docs into \`archive/\` (with the appropriate subdirectory)
- Move superseded plans into \`archive/superseded/\`
- Add missing \`## Status\` sections to plans
- Update \`index.md\` to reflect any moves you make
- Fix broken intra-doc links (relative markdown links that 404)
- Fix naming-convention violations (rename files to \`<date>_kebab-case.md\`)
- Move any root-level docs into subdirectories
- Anything else that is mechanical and low-risk

Be conservative — when in doubt, don't groom inline; surface as a task instead.

## 2. IDENTIFY larger improvements you did NOT do

Bigger changes that need their own focused PR. Examples:
- Rewriting an outdated doc against current code/state
- Splitting an oversized doc into smaller focused ones
- Drafting a missing pattern doc that the codebase clearly needs
- Verifying a plan marked "Implemented" against actual code (search the
  repo for the package/script/config it describes; if missing, the status
  is wrong)
- Expanding a sparse decisions/ doc with proper context

Cap: at most 10 tasks total in your output list. Prioritize the most
valuable. Skip anything you already completed inline.

Difficulty rubric:
- \`easy\`: < 30 min wall clock for a focused Claude session, < 100 LOC
  changed, single-file or near-mechanical
- \`medium\`: 30 min – 2 h, multi-file but bounded scope
- \`hard\`: requires deep code investigation, cross-package context, or a
  large rewrite. These will NOT be auto-implemented.

# Output

Output exactly one valid JSON object matching this schema, AND NOTHING
else after the JSON:

\`\`\`json
{
  "summary": "<one paragraph describing what you groomed inline — this becomes the grooming PR body>",
  "groomedFiles": ["<path you edited>", "<path you edited>", ...],
  "tasks": [
    {
      "title": "<5–80 chars, imperative, e.g. 'Rewrite renovate cleanup against current state'>",
      "slug": "<kebab-case slug, will become the branch name segment>",
      "description": "<20–2000 chars. Include enough context for a follow-up Claude session to implement WITHOUT rerunning the audit. Reference specific files and what's wrong.>",
      "difficulty": "easy" | "medium" | "hard",
      "files": ["<expected path>", ...],
      "category": "stale" | "broken-link" | "status-rot" | "index-drift" | "unverified-implemented" | "rewrite" | "split" | "other"
    }
  ]
}
\`\`\`

If you made no inline edits and identified no tasks, output:
\`{"summary":"No grooming or follow-up tasks needed.","groomedFiles":[],"tasks":[]}\`
`;

export function buildImplementPrompt(input: {
  title: string;
  slug: string;
  description: string;
  difficulty: string;
  category: string;
  files: string[];
  branch: string;
}): string {
  return `You are running as part of an automated grooming pass over the
shepherdjerred/monorepo. You are working in a fresh git worktree on
feature branch \`${input.branch}\` off origin/main. Your job: implement
exactly the following ONE task, no more, no less.

# Task

- **Title**: ${input.title}
- **Slug**: ${input.slug}
- **Difficulty**: ${input.difficulty}
- **Category**: ${input.category}
- **Expected files**: ${input.files.length === 0 ? "(unspecified — use your judgement)" : input.files.join(", ")}

# Description

${input.description}

# Conventions

\`packages/docs/CLAUDE.md\` is authoritative for doc structure & naming.
Read it before editing.

- Naming: \`<yyyy-mm-dd>_kebab-case.md\`
- Plans need a \`## Status\` section near the top
- Archive don't delete: outdated docs go to \`archive/\`
- Update \`packages/docs/index.md\` if you move or rename any doc
- Edits outside \`packages/docs/\` are allowed when this task explicitly
  requires them (e.g. updating a stale code reference). Keep the diff
  scoped to this one task — no incidental refactors. No new files outside
  \`packages/docs/\` unless the task description names them.

# Output

After completing the task, output exactly one valid JSON object matching:

\`\`\`json
{
  "summary": "<one paragraph rationale describing what you changed and why — becomes the PR body>",
  "filesChanged": ["<path>", "<path>", ...]
}
\`\`\`

Then stop. Do not produce any text after the JSON.
`;
}
