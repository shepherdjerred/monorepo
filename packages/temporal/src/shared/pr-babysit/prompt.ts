/**
 * Pure prompt construction + failure-signature helper for the PR babysitter's
 * mutating agent iteration. Import-clean (no I/O) so it is safe in the workflow
 * bundle.
 */
import type { BabysitVerdict } from "./types.ts";

/**
 * A stable signature of WHAT is currently broken (failing CI contexts, conflict
 * paths, blocking review thread ids). The workflow compares successive
 * signatures to detect a stuck loop (same failure N times → escalate).
 */
export function failureSignature(verdict: BabysitVerdict): string {
  const parts = [
    ...verdict.ci.failing.map((c) => `ci:${c}`),
    ...verdict.ci.pending.map((c) => `pending:${c}`),
    ...verdict.conflicts.paths.map((p) => `conflict:${p}`),
    ...verdict.reviews.blocking.map((t) => `thread:${t.threadId}`),
  ];
  return parts.toSorted().join("|");
}

function renderVerdict(verdict: BabysitVerdict): string {
  const lines: string[] = [];
  lines.push(`Current state of PR (head ${verdict.headSha}):`);
  lines.push("");
  if (verdict.ci.failing.length > 0) {
    lines.push(`- CI FAILING (must fix): ${verdict.ci.failing.join(", ")}`);
  }
  if (verdict.ci.pending.length > 0) {
    lines.push(
      `- CI pending (wait, don't churn): ${verdict.ci.pending.join(", ")}`,
    );
  }
  if (verdict.ci.ignoredSoft.length > 0) {
    lines.push(
      `- CI soft failures (IGNORE — do not chase): ${verdict.ci.ignoredSoft.join(", ")}`,
    );
  }
  if (!verdict.conflicts.clean) {
    lines.push(
      `- MERGE CONFLICTS vs ${verdict.conflicts.baseRef}: ${verdict.conflicts.paths.join(", ")}`,
    );
  }
  if (verdict.reviews.blocking.length > 0) {
    lines.push("- BLOCKING review threads (resolve the issue AND the thread):");
    for (const t of verdict.reviews.blocking) {
      lines.push(
        `    • [${t.severity ?? "P?"}] ${t.author} (thread ${t.threadId}): ${t.snippet}`,
      );
    }
  }
  if (verdict.reviews.advisory.length > 0) {
    lines.push("- Advisory review threads (address if easy; not blocking):");
    for (const t of verdict.reviews.advisory) {
      lines.push(`    • ${t.author} (thread ${t.threadId}): ${t.snippet}`);
    }
  }
  return lines.join("\n");
}

export type BabysitPromptInput = {
  owner: string;
  repo: string;
  prNumber: number;
  headRef: string;
  baseRef: string;
  workdir: string;
  goal: string | undefined;
  /** Steering text from a human guidance reply, if the prior iteration asked. */
  guidance: string | undefined;
  verdict: BabysitVerdict;
};

/**
 * Build the mutating-iteration prompt. Unlike `reportOnlyPrompt`, this grants
 * write authority: edit files, run git, commit. It must NOT push (the workflow
 * pushes with a fresh token + `--force-with-lease`), NOR merge/close the PR.
 */
export function babysitIterationPrompt(input: BabysitPromptInput): string {
  const goalLines =
    input.goal === undefined
      ? []
      : ["Owner's stated goal for this PR:", input.goal, ""];
  const guidanceLines =
    input.guidance === undefined
      ? []
      : [
          "Human guidance just provided (apply it this iteration):",
          input.guidance,
          "",
        ];

  return [
    `You are the PR babysitter for ${input.owner}/${input.repo} PR #${String(input.prNumber)}`,
    `(branch ${input.headRef}, base ${input.baseRef}). The repository is checked`,
    `out at ${input.workdir} on the PR branch.`,
    "",
    "Your job: make this one iteration of progress toward 'ready to merge':",
    "  1. CI is green (ignoring the soft failures listed below).",
    "  2. No merge conflicts against the base branch.",
    "  3. No unresolved P3-or-higher review comments (incl. Greptile, and",
    "     Greptile 'comments outside of diff').",
    "",
    ...goalLines,
    ...guidanceLines,
    renderVerdict(input.verdict),
    "",
    "Hard rules:",
    "- You MAY edit files, run shell commands, and run git in the workdir.",
    "- Commit ONLY specific paths (`git add <path>` then commit); never stage",
    "  everything wholesale with the all-flag or `.` (a repo rule).",
    "- Use a Conventional Commit message `type(scope): description`; the repo",
    "  enforces a scope allowlist — use the touched package's scope, or `root`",
    "  for cross-cutting changes.",
    "- Do NOT `git push` — the orchestrator pushes after you return. Do NOT",
    "  merge or close the PR. Do NOT run `git checkout`/`switch`/`stash`/reset",
    "  onto another branch.",
    "- Preserve the PR's intent. If the only way to make something pass would",
    "  change what the PR is trying to do, STOP: set intentConflict=true and",
    "  explain in escalationReason instead of making that change.",
    "- Soft failures (knip / trivy / semgrep) are non-blocking — never chase them.",
    "- The workdir is a plain clone with NO git hooks installed; do not run",
    "  `lefthook install`. Validate your fix by running the touched package's",
    "  own `bun run typecheck` / `bunx eslint` / tests where feasible and",
    "  time-bounded, before committing.",
    "",
    "How to approach each kind of failure:",
    "- CI failing: read the real failing job's log (use `gh pr checks` for the",
    "  context + detail URL; use `bk` if available) and reproduce locally. Fix",
    "  the root cause — never silence lint/type errors with disable-comments or",
    "  type-assertion escape hatches; the repo bans them.",
    "- Merge conflicts: `git fetch origin " + input.baseRef + "` then merge",
    "  `origin/" +
      input.baseRef +
      "` and resolve the conflict, commit. Only do",
    "  this when there is a REAL conflict (one is listed above); do not merge",
    "  base proactively otherwise (it causes CI churn).",
    "- Blocking review threads: make the code change the comment asks for, then",
    "  resolve the thread via the GraphQL `resolveReviewThread` mutation",
    "  (`gh api graphql -f query=...`). If a comment reflects an accepted",
    "  limitation rather than a real fix, reply explaining why, then resolve.",
    "",
    "If you are blocked on something only the human can decide (ambiguous",
    "requirement, risky change, repeated failure you cannot fix), set",
    "needsGuidance=true and put a specific question in guidanceQuestion; do not",
    "guess.",
    "",
    "When done with this iteration, return ONLY JSON matching the provided",
    "schema. Set committed=true and list changedPaths only if you actually",
    "committed. dodMetSelfReport is advisory — the orchestrator re-checks the",
    "real state deterministically.",
  ].join("\n");
}
