import {
  formatReportDisplayValue,
  isLowSampleGameCount,
} from "@scout-for-lol/data";
import type { ExploreMessage } from "@scout-for-lol/data";

/**
 * Render a conversation as markdown for download.
 *
 * Client-side on purpose: everything needed is already on screen, so an export
 * costs no request and works on the shared page too. Only the path being read
 * is exported — other branches are not silently included.
 */
export function conversationToMarkdown(
  title: string,
  messages: ExploreMessage[],
): string {
  const lines: string[] = [`# ${headingText(title)}`, ""];

  for (const message of messages) {
    if (message.role === "user") {
      lines.push(`## ${headingText(message.content)}`, "");
      continue;
    }

    // Assistant prose stays verbatim — it *is* markdown.
    lines.push(message.content, "");

    if (message.preview !== null && message.preview.rows.length > 0) {
      lines.push(...previewTable(message.preview), "");
    }
    if (message.caveats.length > 0) {
      lines.push(...message.caveats.map((caveat) => `> ${caveat}`), "");
    }
    if (message.queryText !== null) {
      lines.push("```sql", message.queryText, "```", "");
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}

/** Markdown-table-safe cell text: `|` escaped, newlines flattened. */
function escapeCell(value: string): string {
  return value.replaceAll("|", String.raw`\|`).replaceAll(/\r?\n/g, " ");
}

/** Heading-safe text: newlines collapsed so a multi-line question stays one heading. */
function headingText(value: string): string {
  return value.replaceAll(/\s*\n\s*/g, " ").trim();
}

/**
 * The preview's first column is the grouping dimension ("Player",
 * "Champion"), whose per-row value lives in `row.label` rather than in
 * `row.values` — so it heads the label cells instead of becoming a column of
 * its own, and values render exactly as the on-screen table formats them.
 */
function previewTable(
  preview: NonNullable<ExploreMessage["preview"]>,
): string[] {
  const [labelColumn, ...metricColumns] = preview.columns;
  const headers = [
    labelColumn?.label ?? "Row",
    ...metricColumns.map((column) => column.label),
  ].map((header) => escapeCell(header));
  const rows = preview.rows.map((row) => [
    escapeCell(row.label),
    ...metricColumns.map((column) => {
      const value = row.values.find(
        (entry) => entry.column === column.key,
      )?.value;
      if (value === undefined || value === null) return "";
      const formatted = formatReportDisplayValue(column, value);
      return escapeCell(
        column.key === "games" || row.games === undefined
          ? formatted
          : `${formatted} (Based on ${row.games.toString()} games)`,
      );
    }),
  ]);
  const table = [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((cells) => `| ${cells.join(" | ")} |`),
  ];
  if (
    preview.rows.some(
      (row) =>
        row.games !== undefined &&
        isLowSampleGameCount(row.games) &&
        metricColumns.some((column) => column.format === "percent"),
    )
  ) {
    table.push("", "Fewer than 10 games — treat this rate as indicative only.");
  }
  return table;
}

/** Trigger a download without leaving the page. */
export function downloadMarkdown(filename: string, contents: string): void {
  const url = URL.createObjectURL(
    new Blob([contents], { type: "text/markdown" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  // In the document, not detached — some browsers ignore a synthetic click on
  // a detached anchor — and the URL is revoked a tick later so revocation
  // cannot race the browser's fetch of the blob.
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

/** A filesystem-safe name derived from the conversation title. */
export function exportFilename(title: string): string {
  // Slice before stripping, so truncation cannot reintroduce an edge hyphen.
  const slug = title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .slice(0, 60)
    .replaceAll(/^-+|-+$/g, "");
  return `${slug.length > 0 ? slug : "conversation"}.md`;
}
