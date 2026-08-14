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
  const lines: string[] = [`# ${title}`, ""];

  for (const message of messages) {
    if (message.role === "user") {
      lines.push(`## ${message.content}`, "");
      continue;
    }

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

function previewTable(
  preview: NonNullable<ExploreMessage["preview"]>,
): string[] {
  const headers = ["Row", ...preview.columns.map((column) => column.label)];
  const rows = preview.rows.map((row) => [
    row.label,
    ...preview.columns.map((column) =>
      String(
        row.values.find((value) => value.column === column.key)?.value ?? "",
      ),
    ),
  ]);
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((cells) => `| ${cells.join(" | ")} |`),
  ];
}

/** Trigger a download without leaving the page. */
export function downloadMarkdown(filename: string, contents: string): void {
  const url = URL.createObjectURL(
    new Blob([contents], { type: "text/markdown" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** A filesystem-safe name derived from the conversation title. */
export function exportFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "")
    .slice(0, 60);
  return `${slug.length > 0 ? slug : "conversation"}.md`;
}
