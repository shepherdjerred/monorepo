import { isYAMLKey } from "./yaml-comments.ts";

/**
 * Helper: Check if a line is part of a commented YAML block
 */
function isPartOfYAMLBlock(line: string, trimmed: string): boolean {
  return (
    line.startsWith(" ") ||
    line.startsWith("\t") ||
    trimmed.startsWith("-") ||
    trimmed.startsWith("#")
  );
}

/**
 * Helper: Check if this is a section header followed by a YAML key
 */
function isSectionHeaderForCommentedBlock(
  nextLine: string | undefined,
): boolean {
  if (!nextLine) {
    return false;
  }
  const nextTrimmed = nextLine.trim();
  return /^[\w.-]+:\s*(\||$)/.test(nextTrimmed);
}

/**
 * Helper: Check if line indicates start of real documentation
 */
function isRealDocumentation(trimmed: string): boolean {
  return trimmed.startsWith("--") || trimmed.startsWith("#");
}

/**
 * Filter out commented-out YAML blocks from the START of a comment string
 * The YAML AST gives us ALL comments, including commented-out config sections
 * We only remove these if they appear BEFORE the real documentation starts
 */
export function filterCommentedOutYAML(comment: string): string {
  const lines = comment.split("\n");
  let startIndex = 0;
  let inCommentedBlock = false;
  let hasSeenRealDoc = false;

  // First pass: find where real documentation starts
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    // Blank line could be end of commented block
    if (trimmed === "") {
      if (inCommentedBlock) {
        inCommentedBlock = false;
      }
      continue;
    }

    // Check if this looks like a commented-out YAML key
    const looksLikeYAMLKeyLocal = isYAMLKey(trimmed);

    if (looksLikeYAMLKeyLocal && !hasSeenRealDoc) {
      // This starts a commented-out YAML block
      inCommentedBlock = true;
      continue;
    }

    // If we're in a commented block, check if this line is part of it
    if (inCommentedBlock) {
      if (isPartOfYAMLBlock(line, trimmed)) {
        continue;
      } else {
        // This line doesn't look like YAML content, we're out of the block
        inCommentedBlock = false;
        hasSeenRealDoc = true;
        startIndex = i;
      }
    } else if (!hasSeenRealDoc) {
      const nextLine = lines[i + 1];

      // Check if this is a section header for a commented-out block
      if (isSectionHeaderForCommentedBlock(nextLine)) {
        continue;
      }

      // Check if this line indicates real documentation
      if (isRealDocumentation(trimmed)) {
        hasSeenRealDoc = true;
        startIndex = i;
      } else {
        // First real prose line
        hasSeenRealDoc = true;
        startIndex = i;
      }
    }
  }

  // Return everything from where real documentation starts
  return lines
    .slice(startIndex)
    .map((l) => l.trim())
    .join("\n");
}
