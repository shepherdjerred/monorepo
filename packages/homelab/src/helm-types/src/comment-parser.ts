/**
 * Check if a line looks like an example/code block rather than documentation
 */
function isExampleLine(line: string): boolean {
  return (
    /^-{3,}/.test(line) ||
    /^BEGIN .*(?:KEY|CERTIFICATE)/.test(line) ||
    /^END .*(?:KEY|CERTIFICATE)/.test(line) ||
    (line.startsWith("-") && (line.includes(":") || /^-\s+\|/.test(line))) ||
    /^\w+:$/.test(line) ||
    /^[\w-]+:\s*$/.test(line) ||
    /^[\w.-]+:\s*\|/.test(line) || // YAML multiline indicator (e.g., "policy.csv: |")
    line.startsWith("|") ||
    line.includes("$ARGOCD_") ||
    line.includes("$KUBE_") ||
    /^\s{2,}/.test(line) ||
    /^echo\s+/.test(line) ||
    /^[pg],\s*/.test(line) // Policy rules like "p, role:..." or "g, subject, ..."
  );
}

/**
 * Check if a line looks like normal prose (sentence case, punctuation)
 */
function looksLikeProse(line: string): boolean {
  return (
    /^[A-Z][\w\s]+[.!?]$/.test(line) ||
    /^[A-Z][\w\s,'"-]+(?::\s*)?$/.test(line) ||
    line.startsWith("Ref:") ||
    line.startsWith("See:") ||
    line.startsWith("http://") ||
    line.startsWith("https://")
  );
}

/**
 * Strip YAML comment markers from a single line
 */
function stripCommentMarkers(line: string): string {
  let result = line.replace(/^#+\s*/, "");
  result = result.replace(/^--\s*/, "");
  result = result.replace(/^##\s*/, "");
  return result.trim();
}

/**
 * Clean up YAML comment text for use in JSDoc
 */
export function cleanYAMLComment(comment: string): string {
  const lines = comment.split("\n").map((line) => stripCommentMarkers(line));

  // Filter and clean lines
  const cleaned: string[] = [];
  let inCodeBlock = false;

  for (const currentLine of lines) {
    if (currentLine.length === 0) {
      if (inCodeBlock) {
        inCodeBlock = false;
      }
      continue;
    }

    if (currentLine.startsWith("@default")) {
      continue;
    }

    if (isExampleLine(currentLine)) {
      inCodeBlock = true;
      continue;
    }

    if (inCodeBlock) {
      if (looksLikeProse(currentLine)) {
        inCodeBlock = false;
      } else {
        continue;
      }
    }

    cleaned.push(currentLine);
  }

  return cleaned.join("\n").trim();
}

/**
 * Parse YAML comments and associate them with keys
 * Exported for testing purposes
 */
export function parseYAMLComments(yamlContent: string): Map<string, string> {
  const lines = yamlContent.split("\n");
  const comments = new Map<string, string>();
  let pendingComments: { text: string; indent: number }[] = [];
  const indentStack: { indent: number; key: string }[] = [];

  for (const line of lines) {
    const currentLine = line;
    const trimmed = currentLine.trim();

    // Skip empty lines
    if (!trimmed) {
      // Empty lines break comment association only if we already have comments
      // This allows comments separated by blank lines to still be associated
      continue;
    }

    // Check if line is a comment
    if (trimmed.startsWith("#")) {
      const comment = trimmed.slice(1).trim();
      if (comment) {
        // Track the indentation level of the comment
        const commentIndent = currentLine.search(/\S/);
        pendingComments.push({ text: comment, indent: commentIndent });
      }
      continue;
    }

    // Check if line has a key
    const keyMatch = /^(\s*)([\w-]+)\s*:/.exec(currentLine);
    if (keyMatch) {
      const indent = keyMatch[1]?.length ?? 0;
      const key = keyMatch[2];
      if (key == null || key === "") {
        continue;
      }

      // Update indent stack
      const lastIndent = indentStack.at(-1);
      while (
        indentStack.length > 0 &&
        lastIndent &&
        lastIndent.indent >= indent
      ) {
        indentStack.pop();
      }

      // Build full key path
      const keyPath =
        indentStack.length > 0
          ? `${indentStack.map((s) => s.key).join(".")}.${key}`
          : key;

      // Check for inline comment
      const inlineCommentMatch = /#\s*(\S.*)$/.exec(currentLine);
      if (inlineCommentMatch?.[1] != null && inlineCommentMatch[1] !== "") {
        pendingComments.push({ text: inlineCommentMatch[1].trim(), indent });
      }

      // Filter pending comments to only those at the same or shallower indent level as this key
      // This prevents comments from deeper nested properties being associated with a shallower property
      const relevantComments = pendingComments.filter(
        (c) => c.indent <= indent,
      );

      // Associate relevant comments with this key
      if (relevantComments.length > 0) {
        // Join and clean comments
        const commentText = cleanYAMLComment(
          relevantComments.map((c) => c.text).join("\n"),
        );
        if (commentText) {
          comments.set(keyPath, commentText);
        }
      }

      // Clear pending comments after processing
      pendingComments = [];

      // Add to indent stack
      indentStack.push({ indent, key });
    } else {
      // If we encounter a non-comment, non-key line, clear pending comments
      // This handles list items and other YAML structures
      pendingComments = [];
    }
  }

  return comments;
}
