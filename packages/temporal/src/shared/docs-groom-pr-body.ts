import type { GroomTask } from "./docs-groom-types.ts";

const FILES_CHANGED_LIMIT = 50;

export type BuildPrBodyInput = {
  kind: "grooming" | "implementation";
  workflowId: string;
  runId: string;
  task?: GroomTask;
  summary: string;
  filesChanged: string[];
};

/**
 * Build the Markdown body of a docs-groom PR. Pure function — no I/O,
 * no Sentry/observability imports — so it's safe to import from the
 * workflow bundle (which webpack walks transitively).
 *
 * Layout:
 *   ## Summary           (claude's summary, verbatim)
 *   ## Task              (implementation kind only — slug/difficulty/category + blockquote of task.description)
 *   ## Files changed     (bullet list, capped at 50, then "_…and N more_")
 *   ---
 *   <footer paragraph>   (kind-specific automation note + workflow-run reference)
 */
export function buildPrBody(input: BuildPrBodyInput): string {
  const sections: string[] = [];

  sections.push("## Summary", "", input.summary);

  if (input.kind === "implementation" && input.task !== undefined) {
    const t = input.task;
    sections.push(
      "",
      "## Task",
      "",
      `- **Slug**: \`${t.slug}\``,
      `- **Difficulty**: ${t.difficulty}`,
      `- **Category**: ${t.category}`,
      "",
      "> " + t.description.replaceAll("\n", "\n> "),
    );
  }

  sections.push("", "## Files changed", "");
  const shown = input.filesChanged.slice(0, FILES_CHANGED_LIMIT);
  for (const f of shown) {
    sections.push(`- \`${f}\``);
  }
  if (input.filesChanged.length > FILES_CHANGED_LIMIT) {
    const extra = input.filesChanged.length - FILES_CHANGED_LIMIT;
    sections.push(`- _…and ${String(extra)} more_`);
  }

  const footerNote =
    input.kind === "grooming"
      ? "Automated daily grooming pass over `packages/docs/`. Larger improvement tasks the audit identified are opened as separate PRs labelled `docs-groom-task`."
      : "Automated implementation PR from the `runDocsGroomTask` workflow.";

  sections.push(
    "",
    "---",
    "",
    footerNote,
    `Workflow run: \`${input.workflowId}\` / \`${input.runId}\` — see Temporal UI.`,
  );

  return sections.join("\n");
}
