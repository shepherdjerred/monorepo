import type { CommentWithMetadata } from "./yaml-comments.ts";

/**
 * Regex-based fallback parser for comments that the YAML AST loses
 * This handles cases with commented-out YAML keys and inconsistent indentation
 * Returns comments with metadata for debugging
 */
export function parseCommentsWithRegex(
  yamlContent: string,
): Map<string, CommentWithMetadata> {
  const comments = new Map<string, CommentWithMetadata>();
  const lines = yamlContent.split("\n");
  let pendingComment: string[] = [];
  let pendingCommentIndent = -1;
  let pendingDebugInfo: string[] = [];

  lines.forEach((line, lineNum) => {
    const trimmed = line.trim();

    // Skip empty lines - blank lines reset pending comments
    // This ensures comments for commented-out keys don't leak to next real key
    if (!trimmed) {
      // Only reset if we had a commented-out key (pendingCommentIndent === -1)
      // This allows multi-line comments for real keys to work
      if (pendingComment.length > 0 && pendingCommentIndent === -1) {
        pendingDebugInfo.push(
          `Line ${String(lineNum)}: Blank line after commented-out key, resetting pending`,
        );
        pendingComment = [];
        pendingDebugInfo = [];
      }
      return;
    }

    // Check if this is a comment line
    if (trimmed.startsWith("#")) {
      // Extract comment text (handle multiple # characters)
      let commentText = trimmed;
      while (commentText.startsWith("#")) {
        commentText = commentText.slice(1);
      }
      commentText = commentText.trim();

      // Skip commented-out YAML keys (these are not documentation)
      // Match patterns like "key: value" or "key:" but NOT prose-like text
      // This includes quoted values like: key: "value"
      const looksLikeYAMLKeyLocal =
        /^[\w.-]+:\s*(?:\||$|[\w.-]+$|"[^"]*"$|'[^']*'$|[[{])/.test(
          commentText,
        );

      if (looksLikeYAMLKeyLocal) {
        // This is a commented-out YAML key, which means the pending comments
        // were describing this commented-out section, not a future real key
        // So we should discard them
        pendingDebugInfo.push(
          `Line ${String(lineNum)}: Commented-out YAML key detected: "${commentText}", discarding pending`,
        );
        pendingComment = [];
        pendingCommentIndent = -1;
        pendingDebugInfo = [];
      } else {
        const commentIndent = line.search(/\S/);

        // If we just discarded comments (indent === -1), this is a fresh start
        if (pendingCommentIndent === -1) {
          pendingComment = [commentText];
          pendingCommentIndent = commentIndent;
          pendingDebugInfo = [
            `Line ${String(lineNum)}: Fresh start (indent=${String(commentIndent)}): "${commentText}"`,
          ];
        } else if (
          commentIndent === pendingCommentIndent ||
          Math.abs(commentIndent - pendingCommentIndent) <= 2
        ) {
          // Same indent level, add to pending
          pendingComment.push(commentText);
          pendingDebugInfo.push(
            `Line ${String(lineNum)}: Continuing (indent=${String(commentIndent)}): "${commentText}"`,
          );
        } else {
          // Different indent, reset
          pendingDebugInfo.push(
            `Line ${String(lineNum)}: Different indent (${String(commentIndent)} vs ${String(pendingCommentIndent)}), resetting`,
          );
          pendingComment = [commentText];
          pendingCommentIndent = commentIndent;
          pendingDebugInfo.push(
            `Line ${String(lineNum)}: New start: "${commentText}"`,
          );
        }
      }
      return;
    }

    // Check if this is a YAML key line
    const keyMatchRegex = /^([\w.-]+):\s/;
    const keyMatch = keyMatchRegex.exec(trimmed);
    if (keyMatch && pendingComment.length > 0) {
      const key = keyMatch[1];
      if (key != null && key !== "") {
        const keyIndent = line.search(/\S/);

        // Only associate comment if indentation matches closely
        // Allow 2 space difference (for comment being indented slightly different)
        if (
          pendingCommentIndent === -1 ||
          Math.abs(keyIndent - pendingCommentIndent) <= 2
        ) {
          const commentText = pendingComment.join("\n");
          const debugInfo = [
            ...pendingDebugInfo,
            `Line ${String(lineNum)}: Associating with key "${key}"`,
          ].join("\n");

          comments.set(key, {
            text: commentText,
            metadata: {
              source: "REGEX",
              rawComment: commentText,
              indent: keyIndent,
              debugInfo,
            },
          });
        } else {
          pendingDebugInfo.push(
            `Line ${String(lineNum)}: Skipping key "${key}" due to indent mismatch (${String(keyIndent)} vs ${String(pendingCommentIndent)})`,
          );
        }

        // Reset for next key
        pendingComment = [];
        pendingCommentIndent = -1;
        pendingDebugInfo = [];
      }
    } else if (!trimmed.startsWith("#")) {
      // Non-comment, non-key line - reset pending comment
      if (pendingComment.length > 0) {
        pendingDebugInfo.push(
          `Line ${String(lineNum)}: Non-comment/non-key line, resetting pending`,
        );
      }
      pendingComment = [];
      pendingCommentIndent = -1;
      pendingDebugInfo = [];
    }
  });

  return comments;
}
