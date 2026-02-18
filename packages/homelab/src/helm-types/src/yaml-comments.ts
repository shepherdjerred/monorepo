import { parseDocument } from "yaml";
import { z } from "zod";
import { filterCommentedOutYAML } from "./yaml-comment-filters.ts";
import { parseCommentsWithRegex } from "./yaml-comment-regex-parser.ts";

/**
 * Metadata about how a comment was extracted
 */
export type CommentMetadata = {
  source: "AST" | "REGEX";
  rawComment?: string;
  indent?: number;
  debugInfo?: string;
};

/**
 * Comment with metadata for debugging
 */
export type CommentWithMetadata = {
  text: string;
  metadata: CommentMetadata;
};

/**
 * Helper: Check if a line looks like a YAML key (e.g., "key: value" or "key:")
 * Exported for testing purposes
 */
export function isYAMLKey(line: string): boolean {
  return /^[\w.-]+:\s*(\||$)/.test(line);
}

/**
 * Helper: Check if a line looks like a simple YAML value assignment
 * Exported for testing purposes
 */
export function isSimpleYAMLValue(line: string): boolean {
  const hasURL = line.includes("http://") || line.includes("https://");
  const isRef = /^ref:/i.test(line);
  return /^[\w.-]+:\s[^:]+$/.test(line) && !hasURL && !isRef;
}

/**
 * Helper: Check if a line is a section header (short line followed by YAML config)
 * Exported for testing purposes
 */
export function isSectionHeader(
  line: string,
  nextLine: string | undefined,
): boolean {
  if (!nextLine) {
    return false;
  }

  const isFollowedByYAMLKey =
    /^[\w.-]+:\s*\|/.test(nextLine) ||
    /^[\w.-]+:\s*$/.test(nextLine) ||
    /^[\w.-]+:\s+/.test(nextLine);

  if (!isFollowedByYAMLKey) {
    return false;
  }

  const wordCount = line.split(/\s+/).length;
  const hasConfigKeywords =
    /\b(configuration|config|example|setup|settings?|options?|alternative)\b/i.test(
      line,
    );
  const endsWithPunctuation = /[.!?]$/.test(line);
  const hasURL = line.includes("http://") || line.includes("https://");
  const startsWithArticle = /^(This|The|A|An)\s/i.test(line);
  const startsWithCommonWord =
    /^(This|The|A|An|It|For|To|If|When|You|We|Use|Configure)\s/i.test(line);

  return (
    ((wordCount === 2 && !startsWithCommonWord) ||
      (hasConfigKeywords && !startsWithCommonWord)) &&
    !endsWithPunctuation &&
    !hasURL &&
    !/^ref:/i.test(line) &&
    !startsWithArticle
  );
}

/**
 * Helper: Check if a line looks like code/YAML example
 * Exported for testing purposes
 */
export function isCodeExample(line: string, wordCount: number): boolean {
  const looksLikeYAMLKey = isYAMLKey(line);
  const looksLikeSimpleYAMLValue = isSimpleYAMLValue(line);
  const looksLikeYAMLList =
    line.startsWith("-") && (line.includes(":") || /^-\s+\|/.test(line));
  const looksLikePolicyRule = /^[pg],\s*/.test(line);
  const hasIndentation = /^\s{2,}/.test(line);
  const looksLikeCommand =
    /^echo\s+/.test(line) ||
    line.includes("$ARGOCD_") ||
    line.includes("$KUBE_");
  const isSeparator =
    /^-{3,}/.test(line) ||
    /^BEGIN .*(KEY|CERTIFICATE)/.test(line) ||
    /^END .*(KEY|CERTIFICATE)/.test(line);

  return (
    isSeparator ||
    looksLikeYAMLKey ||
    (looksLikeSimpleYAMLValue && wordCount <= 4) ||
    looksLikeYAMLList ||
    looksLikePolicyRule ||
    hasIndentation ||
    looksLikeCommand ||
    line.startsWith("|")
  );
}

/**
 * Helper: Check if a line looks like prose (real documentation)
 * Exported for testing purposes
 */
export function looksLikeProse(line: string, wordCount: number): boolean {
  const hasURL = line.includes("http://") || line.includes("https://");
  const startsWithCapital = /^[A-Z]/.test(line);
  const hasEndPunctuation = /[.!?:]$/.test(line);
  const notYamlKey = !(isYAMLKey(line) && !hasURL && !/^ref:/i.test(line));
  const reasonableLength = line.length > 10;
  const hasMultipleWords = wordCount >= 3;
  const startsWithArticle = /^(This|The|A|An)\s/i.test(line);

  // Lines starting with markers like ^, ->, etc. are documentation references
  const isReferenceMarker = /^(\^|->|→)\s/.test(line);

  return (
    (startsWithCapital || isReferenceMarker) &&
    (hasEndPunctuation ||
      hasURL ||
      startsWithArticle ||
      hasMultipleWords ||
      isReferenceMarker) &&
    notYamlKey &&
    reasonableLength
  );
}

/**
 * Helper: Normalize a comment line by removing markers
 * Exported for testing purposes
 */
export function normalizeCommentLine(line: string): string {
  let normalized = line.trim();
  normalized = normalized.replace(/^#+\s*/, ""); // Remove leading # symbols
  normalized = normalized.replace(/^--\s*/, ""); // Remove Helm's -- marker
  normalized = normalized.replace(/^@param\s+[\w.-]+\s+/, ""); // Remove Bitnami's @param prefix
  normalized = normalized.replace(/^@section\s+/, ""); // Remove Bitnami's @section prefix
  return normalized.trim();
}

/**
 * Clean up YAML comment text for use in JSDoc
 * Removes Helm-specific markers and filters out code examples and section headers
 */
export function cleanYAMLComment(comment: string): string {
  if (!comment) {
    return "";
  }

  // Normalize all lines
  const lines = comment.split("\n").map((line) => normalizeCommentLine(line));

  // Filter out code examples and section headers, keep documentation
  const cleaned: string[] = [];
  let inCodeBlock = false;
  let inExample = false; // Track if we're in an "Example:" section (keep these!)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    // Empty lines end code blocks (but not examples)
    if (!line) {
      if (inCodeBlock && !inExample) {
        inCodeBlock = false;
      }
      continue;
    }

    // Skip @default lines (we'll generate our own)
    if (line.startsWith("@default")) {
      continue;
    }

    // Check if this line starts an Example section (preserve these!)
    if (/^Example:?$/i.test(line.trim())) {
      inExample = true;
      inCodeBlock = true; // Treat examples as special code blocks
      cleaned.push(line);
      continue;
    }

    const nextLine = lines[i + 1];
    const wordCount = line.split(/\s+/).length;

    // Skip section headers
    if (isSectionHeader(line, nextLine)) {
      continue;
    }

    // If we're in an example section, keep all lines (including code)
    if (inExample) {
      cleaned.push(line);
      // Check if we're exiting the example section
      if (line.startsWith("For more information") || line.startsWith("Ref:")) {
        inExample = false;
        inCodeBlock = false;
      }
      continue;
    }

    // Check if this line is a code example
    if (isCodeExample(line, wordCount)) {
      inCodeBlock = true;
      continue;
    }

    // Resume prose when we hit a proper sentence
    if (inCodeBlock) {
      if (looksLikeProse(line, wordCount)) {
        inCodeBlock = false;
      } else {
        continue;
      }
    }

    cleaned.push(line);
  }

  return cleaned.join("\n").trim();
}

/**
 * Pre-process YAML to uncomment commented-out keys
 * In Helm charts, commented-out keys are documentation of available options
 * e.g., "## key: value" or "# key: value"
 *
 * This allows us to parse them as real keys and associate their comments
 *
 * Only uncomments keys that are:
 * - At root level or similar indentation to real keys
 * - Not part of "Example:" blocks
 * - Not part of documentation prose (have their own dedicated comment block)
 * - Not deeply nested (which would indicate example YAML)
 *
 * Exported for testing purposes
 */
export function preprocessYAMLComments(yamlContent: string): string {
  const lines = yamlContent.split("\n");
  const processedLines: string[] = [];
  let inExampleBlock = false;
  let inBlockScalar = false; // Track if we're in a block scalar (| or >)
  let lastRealKeyIndent = -1;
  let consecutiveCommentedKeys = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    // Detect "Example:" markers (case-insensitive)
    if (/^##?\s*Example:?$/i.test(trimmed)) {
      inExampleBlock = true;
      processedLines.push(line);
      continue;
    }

    // Exit example block on blank line or "For more information"
    if (
      inExampleBlock &&
      (!trimmed ||
        trimmed.startsWith("For more information") ||
        trimmed.startsWith("Ref:"))
    ) {
      inExampleBlock = false;
    }

    // Detect if previous commented line had a block scalar indicator (| or >)
    if (i > 0) {
      const prevLine = lines[i - 1];
      const prevTrimmed = prevLine?.trim() ?? "";
      // Check if previous line is a commented key with block scalar
      if (/^#+\s*[\w.-]+:\s*[|>]\s*$/.test(prevTrimmed)) {
        inBlockScalar = true;
      }
    }

    // Exit block scalar on non-indented line or blank line
    if (inBlockScalar) {
      const isIndented =
        trimmed.length > 0 &&
        (line.startsWith("  ") ||
          line.startsWith("\t") ||
          /^#\s{2,}/.test(line));
      if (trimmed.length === 0 || !isIndented) {
        inBlockScalar = false;
      }
    }

    // Track indentation of real (uncommented) keys
    if (!trimmed.startsWith("#") && /^[\w.-]+:/.test(trimmed)) {
      lastRealKeyIndent = line.search(/\S/);
      consecutiveCommentedKeys = 0;
    }

    // Don't uncomment if we're in an example block or block scalar
    if (inExampleBlock || inBlockScalar) {
      processedLines.push(line);
      consecutiveCommentedKeys = 0;
      continue;
    }

    // Check if this is a commented-out YAML key
    // Pattern: one or more # followed by optional whitespace, then key: value
    const commentedKeyMatch = /^([ \t]*)(#+)\s*([\w.-]+:\s*(?:\S.*)?)$/.exec(
      line,
    );

    if (commentedKeyMatch) {
      const [, indent, , keyValue] = commentedKeyMatch;

      if (!keyValue || !indent) {
        processedLines.push(line);
        continue;
      }

      // Check if the key part looks like a valid YAML key (not prose)
      const keyPart = keyValue.split(":")[0]?.trim() ?? "";
      const isValidKey = /^[\w.-]+$/.test(keyPart);

      // Don't uncomment documentation references like "ref: https://..."
      const isDocReference =
        /^ref:/i.test(keyValue) &&
        (keyValue.includes("http://") || keyValue.includes("https://"));

      // Don't uncomment URLs (they might be continuation lines in multi-line Ref comments)
      const isURL =
        keyValue.trim().startsWith("http://") ||
        keyValue.trim().startsWith("https://");

      if (isValidKey && !isDocReference && !isURL) {
        const keyIndent = indent.length;

        // Check the context: look at previous lines to see if this is part of prose
        // If the previous line is prose (not a commented key or blank), this is likely an example
        const prevLine = i > 0 ? lines[i - 1] : "";
        const prevTrimmed = prevLine?.trim() ?? "";
        const prevIsCommentedKey = /^#+\s*[\w.-]+:\s/.test(prevTrimmed);
        const prevIsBlank = !prevTrimmed;
        const prevIsListItem =
          prevTrimmed.startsWith("#") &&
          prevTrimmed.slice(1).trim().startsWith("-");

        // If previous line is prose or a list item, this is likely a YAML example
        const likelyExample =
          (!prevIsBlank &&
            !prevIsCommentedKey &&
            prevTrimmed.startsWith("#")) ||
          prevIsListItem;

        // Also check if we're in a sequence of commented keys (good sign of commented-out config)
        if (prevIsCommentedKey) {
          consecutiveCommentedKeys++;
        } else if (!prevIsBlank) {
          consecutiveCommentedKeys = 0;
        }

        // Only uncomment if:
        // 1. It's not likely an example (based on context)
        // 2. AND (we haven't seen any real keys yet OR this key is at similar indent level)
        // 3. OR we've seen multiple consecutive commented keys (likely a commented-out config block)
        const shouldUncomment =
          !likelyExample &&
          (lastRealKeyIndent === -1 ||
            Math.abs(keyIndent - lastRealKeyIndent) <= 4 ||
            consecutiveCommentedKeys >= 2);

        if (shouldUncomment) {
          processedLines.push(`${indent}${keyValue}`);
          continue;
        }
      }
    }

    // Reset consecutive count if not a commented key
    if (!commentedKeyMatch) {
      consecutiveCommentedKeys = 0;
    }

    // Keep the line as-is
    processedLines.push(line);
  }

  return processedLines.join("\n");
}

/**
 * Parse Bitnami-style @param directives from a comment
 * Format: @param key.path Description
 * Returns: Map of extracted params and remaining non-param lines
 * Exported for testing purposes
 */
export function parseBitnamiParams(comment: string): {
  params: Map<string, string>;
  remainingLines: string[];
} {
  const lines = comment.split("\n");
  const params = new Map<string, string>();
  const remainingLines: string[] = [];

  for (const line of lines) {
    const trimmedLine = line
      .trim()
      .replace(/^#+\s*/, "")
      .replace(/^--\s*/, "");

    const paramMatch = /^@param\s+([\w.-]+)\s+(.+)$/.exec(trimmedLine);
    if (paramMatch) {
      const [, paramKey, description] = paramMatch;
      if (paramKey && description) {
        params.set(paramKey, description);
      }
    } else if (trimmedLine) {
      remainingLines.push(trimmedLine);
    }
  }

  return { params, remainingLines };
}

/**
 * Parse YAML comments with metadata for debugging
 * Returns comments with information about how they were extracted
 * Exported for testing purposes
 */
export function parseYAMLCommentsWithMetadata(
  yamlContent: string,
): Map<string, CommentWithMetadata> {
  const comments = new Map<string, CommentWithMetadata>();

  try {
    // Pre-process to uncomment commented-out keys
    // This allows Helm chart commented-out options to be parsed as real keys
    const preprocessedYaml = preprocessYAMLComments(yamlContent);
    const doc = parseDocument(preprocessedYaml);

    // Build a regex-based fallback map for cases where YAML parser loses comments
    // Use preprocessed YAML so commented-out keys are treated as real keys
    const regexComments = parseCommentsWithRegex(preprocessedYaml);

    // Recursively walk the YAML AST and extract comments
    function visitNode(
      node: unknown,
      keyPath: string[] = [],
      inheritedComment = "",
    ): void {
      if (!node) {
        return;
      }

      // Handle map/object nodes - check if node has items array
      const mapNodeCheck = z
        .object({
          items: z.array(z.unknown()),
          commentBefore: z.unknown().optional(),
        })
        .safeParse(node);
      if (mapNodeCheck.success) {
        // Extract the map's own comment (to be inherited by first child if needed)
        let mapComment = inheritedComment;
        const mapCommentCheck = z
          .string()
          .safeParse(mapNodeCheck.data.commentBefore);
        if (mapCommentCheck.success) {
          mapComment = mapCommentCheck.data;
        }

        for (let i = 0; i < mapNodeCheck.data.items.length; i++) {
          const item = mapNodeCheck.data.items[i];
          const itemCheck = z
            .object({ key: z.unknown(), value: z.unknown() })
            .safeParse(item);
          if (!itemCheck.success) {
            continue;
          }

          // Get the key - validate it has a value property that's a string
          const keyNodeCheck = z
            .object({ value: z.string() })
            .safeParse(itemCheck.data.key);
          if (!keyNodeCheck.success) {
            continue;
          }

          const key = keyNodeCheck.data.value;
          const newPath = [...keyPath, key];
          const fullKey = newPath.join(".");

          // Extract comment from the key's commentBefore
          let comment = "";
          const keyCommentCheck = z
            .object({ commentBefore: z.unknown() })
            .safeParse(itemCheck.data.key);
          if (keyCommentCheck.success) {
            const commentCheck = z
              .string()
              .safeParse(keyCommentCheck.data.commentBefore);
            comment = commentCheck.success ? commentCheck.data : "";
          }

          // Also check the pair itself for comments
          const pairCommentCheck = z
            .object({ commentBefore: z.unknown() })
            .safeParse(item);
          if (pairCommentCheck.success) {
            const pairCommentValue = z
              .string()
              .safeParse(pairCommentCheck.data.commentBefore);
            const pairComment = pairCommentValue.success
              ? pairCommentValue.data
              : "";
            if (pairComment) {
              comment = comment ? `${pairComment}\n${comment}` : pairComment;
            }
          }

          // Check for inline comments on the value
          const valueCommentCheck = z
            .object({ comment: z.unknown() })
            .safeParse(itemCheck.data.value);
          if (valueCommentCheck.success) {
            const inlineComment = z
              .string()
              .safeParse(valueCommentCheck.data.comment);
            if (inlineComment.success && inlineComment.data) {
              comment = comment
                ? `${comment}\n${inlineComment.data}`
                : inlineComment.data;
            }
          }

          // If this is the first item and has no comment, inherit from map
          if (i === 0 && !comment && mapComment) {
            comment = mapComment;
          }

          // Filter out commented-out YAML blocks before cleaning
          if (comment) {
            comment = filterCommentedOutYAML(comment);
          }

          // Check if this is a Bitnami-style @param comment
          // These need special handling before cleaning
          const hasParamDirective = comment.includes("@param ");
          if (hasParamDirective) {
            const { params, remainingLines } = parseBitnamiParams(comment);

            // Store each param comment with its specific key
            for (const [paramKey, description] of params.entries()) {
              comments.set(paramKey, {
                text: description,
                metadata: {
                  source: "AST",
                  rawComment: comment,
                  debugInfo: `Bitnami @param directive for ${paramKey}`,
                },
              });
            }

            // Store remaining non-param lines with the current key if any
            if (remainingLines.length > 0) {
              const cleaned = cleanYAMLComment(remainingLines.join("\n"));
              if (cleaned) {
                comments.set(fullKey, {
                  text: cleaned,
                  metadata: {
                    source: "AST",
                    rawComment: comment,
                    debugInfo: `AST comment after extracting @param directives`,
                  },
                });
              }
            }
          } else {
            // Clean and store the comment normally
            if (comment) {
              const cleaned = cleanYAMLComment(comment);
              if (cleaned) {
                comments.set(fullKey, {
                  text: cleaned,
                  metadata: {
                    source: "AST",
                    rawComment: comment,
                    debugInfo: `Direct AST comment for ${fullKey}`,
                  },
                });
              }
            }
          }

          // Check if the value has a commentBefore (for nested structures)
          let valueInheritedComment = "";
          const valueCommentBeforeCheck = z
            .object({ commentBefore: z.unknown() })
            .safeParse(itemCheck.data.value);
          if (valueCommentBeforeCheck.success) {
            const valueCommentBefore = z
              .string()
              .safeParse(valueCommentBeforeCheck.data.commentBefore);
            if (valueCommentBefore.success) {
              valueInheritedComment = valueCommentBefore.data;
            }
          }

          // Recurse into nested structures
          if (itemCheck.data.value) {
            visitNode(itemCheck.data.value, newPath, valueInheritedComment);
          }
        }
      }
    }

    // Start with the document contents
    if (doc.contents) {
      visitNode(doc.contents, []);
    }

    // Merge regex comments as fallback - only use them if AST parsing didn't find a comment
    // This handles cases where YAML parser loses comments due to:
    // - Inconsistent indentation
    // - Commented-out YAML keys mixed with documentation
    // - Other edge cases
    for (const [key, commentWithMeta] of regexComments.entries()) {
      if (!comments.has(key)) {
        const cleaned = cleanYAMLComment(commentWithMeta.text);
        if (cleaned) {
          comments.set(key, {
            text: cleaned,
            metadata: {
              ...commentWithMeta.metadata,
              debugInfo: `${commentWithMeta.metadata.debugInfo ?? ""}\nCleaned from: "${commentWithMeta.text}"`,
            },
          });
        }
      }
    }
  } catch (error) {
    // If YAML parsing fails, fall back to empty map
    console.warn("Failed to parse YAML comments:", error);
  }

  return comments;
}

/**
 * Parse YAML comments and associate them with keys
 * Returns a simple Map<string, string> for backward compatibility
 * Exported for testing purposes
 */
export function parseYAMLComments(yamlContent: string): Map<string, string> {
  const commentsWithMetadata = parseYAMLCommentsWithMetadata(yamlContent);
  const simpleComments = new Map<string, string>();

  for (const [key, commentWithMeta] of commentsWithMetadata.entries()) {
    simpleComments.set(key, commentWithMeta.text);
  }

  return simpleComments;
}
