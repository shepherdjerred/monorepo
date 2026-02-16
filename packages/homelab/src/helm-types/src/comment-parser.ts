/**
 * Clean up YAML comment text for use in JSDoc
 */
export function cleanYAMLComment(comment: string): string {
  const lines = comment.split("\n").map((line) => {
    // Remove leading # symbols
    line = line.replace(/^#+\s*/, "");
    // Remove common Helm chart comment markers
    line = line.replace(/^--\s*/, "");
    line = line.replace(/^##\s*/, "");
    return line.trim();
  });

  // Filter and clean lines
  const cleaned: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    const currentLine = line;

    // Skip empty lines
    if (currentLine.length === 0) {
      if (inCodeBlock) inCodeBlock = false;
      continue;
    }

    // Skip @default lines (we'll generate our own)
    if (currentLine.startsWith("@default")) continue;

    // Detect various patterns that indicate this is an example/code block, not documentation
    const isExample =
      /^-{3,}/.test(currentLine) ||
      /^BEGIN .*(KEY|CERTIFICATE)/.test(currentLine) ||
      /^END .*(KEY|CERTIFICATE)/.test(currentLine) ||
      (currentLine.startsWith("-") && (currentLine.includes(":") || /^-\s+\|/.test(currentLine))) ||
      /^\w+:$/.test(currentLine) ||
      /^[\w-]+:\s*$/.test(currentLine) ||
      /^[\w.-]+:\s*\|/.test(currentLine) || // YAML multiline indicator (e.g., "policy.csv: |")
      currentLine.startsWith("|") ||
      currentLine.includes("$ARGOCD_") ||
      currentLine.includes("$KUBE_") ||
      /^\s{2,}/.test(currentLine) ||
      /^echo\s+/.test(currentLine) ||
      /^[pg],\s*/.test(currentLine); // Policy rules like "p, role:..." or "g, subject, ..."

    if (isExample) {
      inCodeBlock = true;
      continue;
    }

    // If we're in a code block, skip until we hit normal prose
    if (inCodeBlock) {
      // Check if this line looks like normal prose (sentence case, punctuation)
      const looksLikeProse =
        /^[A-Z][\w\s]+[.!?]$/.test(currentLine) ||
        /^[A-Z][\w\s,'"-]+:?\s*$/.test(currentLine) ||
        currentLine.startsWith("Ref:") ||
        currentLine.startsWith("See:") ||
        currentLine.startsWith("http://") ||
        currentLine.startsWith("https://");

      if (looksLikeProse) {
        inCodeBlock = false;
      } else {
        continue;
      }
    }

    // Keep the line
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
      const comment = trimmed.substring(1).trim();
      if (comment) {
        // Track the indentation level of the comment
        const commentIndent = currentLine.search(/\S/);
        pendingComments.push({ text: comment, indent: commentIndent });
      }
      continue;
    }

    // Check if line has a key
    const keyMatch = /^(\s*)([a-zA-Z0-9_-]+)\s*:/.exec(currentLine);
    if (keyMatch) {
      const indent = keyMatch[1]?.length ?? 0;
      const key = keyMatch[2];
      if (!key) continue;

      // Update indent stack
      const lastIndent = indentStack[indentStack.length - 1];
      while (indentStack.length > 0 && lastIndent && lastIndent.indent >= indent) {
        indentStack.pop();
      }

      // Build full key path
      const keyPath = indentStack.length > 0 ? `${indentStack.map((s) => s.key).join(".")}.${key}` : key;

      // Check for inline comment
      const inlineCommentMatch = /#\s*(.+)$/.exec(currentLine);
      if (inlineCommentMatch?.[1]) {
        pendingComments.push({ text: inlineCommentMatch[1].trim(), indent });
      }

      // Filter pending comments to only those at the same or shallower indent level as this key
      // This prevents comments from deeper nested properties being associated with a shallower property
      const relevantComments = pendingComments.filter((c) => c.indent <= indent);

      // Associate relevant comments with this key
      if (relevantComments.length > 0) {
        // Join and clean comments
        const commentText = cleanYAMLComment(relevantComments.map((c) => c.text).join("\n"));
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
