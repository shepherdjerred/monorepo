import type { FileChange } from "./types.js";

const MAX_DISCORD_EMBED_LENGTH = 4096;
const MAX_DIFF_PREVIEW_LENGTH = 1800;

/**
 * Format file changes as a Discord-friendly diff preview
 */
export function formatDiffForDiscord(changes: FileChange[]): string {
  if (changes.length === 0) {
    return "No changes made.";
  }

  const parts: string[] = [];

  for (const change of changes) {
    const header = formatChangeHeader(change);
    const content = formatChangeContent(change);
    parts.push(`${header}\n${content}`);
  }

  let result = parts.join("\n\n");

  // Truncate if too long
  if (result.length > MAX_DIFF_PREVIEW_LENGTH) {
    result =
      result.slice(0, MAX_DIFF_PREVIEW_LENGTH - 50) +
      "\n\n... (truncated, more changes not shown)";
  }

  return result;
}

function formatChangeHeader(change: FileChange): string {
  const icon = getChangeIcon(change.changeType);
  return `${icon} **${change.filePath}** (${change.changeType})`;
}

function getChangeIcon(changeType: FileChange["changeType"]): string {
  switch (changeType) {
    case "create":
      return "+";
    case "modify":
      return "~";
    case "delete":
      return "-";
  }
}

function formatChangeContent(change: FileChange): string {
  switch (change.changeType) {
    case "create":
      return formatCodeBlock(change.newContent ?? "", "diff", "+");

    case "delete":
      return formatCodeBlock(change.oldContent ?? "", "diff", "-");

    case "modify":
      return formatEditDiff(change.oldContent, change.newContent);
  }
}

function formatEditDiff(
  oldContent: string | null,
  newContent: string | null,
): string {
  if (!oldContent && !newContent) {
    return "```\n(no content)\n```";
  }

  const lines: string[] = [];

  if (oldContent) {
    for (const line of oldContent.split("\n")) {
      lines.push(`- ${line}`);
    }
  }

  if (newContent) {
    for (const line of newContent.split("\n")) {
      lines.push(`+ ${line}`);
    }
  }

  return formatCodeBlock(lines.join("\n"), "diff");
}

function formatCodeBlock(
  content: string,
  language: string,
  prefix?: string,
): string {
  let formatted = content;

  // Add prefix to each line if specified
  if (prefix) {
    formatted = content
      .split("\n")
      .map((line) => `${prefix} ${line}`)
      .join("\n");
  }

  // Truncate long content
  if (formatted.length > 500) {
    formatted = formatted.slice(0, 450) + "\n... (truncated)";
  }

  return `\`\`\`${language}\n${formatted}\n\`\`\``;
}

/**
 * Format a summary of changes for a message
 */
export function formatChangeSummary(changes: FileChange[]): string {
  if (changes.length === 0) {
    return "No files changed.";
  }

  const created = changes.filter((c) => c.changeType === "create").length;
  const modified = changes.filter((c) => c.changeType === "modify").length;
  const deleted = changes.filter((c) => c.changeType === "delete").length;

  const parts: string[] = [];
  if (created > 0) {parts.push(`${String(created)} file${created > 1 ? "s" : ""} created`);}
  if (modified > 0)
    {parts.push(`${String(modified)} file${modified > 1 ? "s" : ""} modified`);}
  if (deleted > 0) {parts.push(`${String(deleted)} file${deleted > 1 ? "s" : ""} deleted`);}

  return parts.join(", ");
}

/**
 * Format changes list as bullet points
 */
export function formatChangedFilesList(changes: FileChange[]): string {
  return changes
    .map((c) => {
      const icon = getChangeIcon(c.changeType);
      return `${icon} \`${c.filePath}\``;
    })
    .join("\n");
}

/**
 * Check if the diff preview would fit in a Discord embed
 */
export function willFitInEmbed(content: string): boolean {
  return content.length <= MAX_DISCORD_EMBED_LENGTH;
}
