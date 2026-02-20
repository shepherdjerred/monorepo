import { parseDocument } from "yaml";
import { z } from "zod";
import { filterCommentedOutYAML } from "./yaml-comment-filters.ts";
import { parseCommentsWithRegex } from "./yaml-comment-regex-parser.ts";
import { preprocessYAMLComments } from "./yaml-preprocess.ts";

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
  return /^[\w.-]+:\s*(?:\||$)/.test(line);
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
export function isSectionHeader(line: string, nextLine?: string): boolean {
  if (nextLine == null || nextLine === "") {
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
    /\b(?:configuration|config|example|setup|settings?|options?|alternative)\b/i.test(
      line,
    );
  const endsWithPunctuation = /[.!?]$/.test(line);
  const hasURL = line.includes("http://") || line.includes("https://");
  const startsWithArticle = /^(?:This|The|A|An)\s/i.test(line);
  const startsWithCommonWord =
    /^(?:This|The|A|An|It|For|To|If|When|You|We|Use|Configure)\s/i.test(line);

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
    /^BEGIN .*(?:KEY|CERTIFICATE)/.test(line) ||
    /^END .*(?:KEY|CERTIFICATE)/.test(line);

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
  const startsWithArticle = /^(?:This|The|A|An)\s/i.test(line);

  // Lines starting with markers like ^, ->, etc. are documentation references
  const isReferenceMarker = /^(?:\^|->|→)\s/.test(line);

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

    const paramMatch = /^@param\s+([\w.-]+)\s+(\S.*)$/.exec(trimmedLine);
    if (paramMatch) {
      const [, paramKey, description] = paramMatch;
      if (
        paramKey != null &&
        paramKey !== "" &&
        description != null &&
        description !== ""
      ) {
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

    // Zod schemas for YAML AST parsing, defined once
    const MapNodeSchema = z.object({
      items: z.array(z.unknown()),
      commentBefore: z.unknown().optional(),
    });
    const PairSchema = z.object({ key: z.unknown(), value: z.unknown() });
    const KeyValueSchema = z.object({ value: z.string() });
    const CommentBeforeSchema = z.object({ commentBefore: z.unknown() });
    const InlineCommentSchema = z.object({ comment: z.unknown() });

    /**
     * Extract the commentBefore string from a YAML node
     */
    function extractCommentBefore(node: unknown): string {
      const check = CommentBeforeSchema.safeParse(node);
      if (!check.success) {
        return "";
      }
      const strCheck = z.string().safeParse(check.data.commentBefore);
      return strCheck.success ? strCheck.data : "";
    }

    /**
     * Extract the inline comment string from a YAML value node
     */
    function extractInlineComment(node: unknown): string {
      const check = InlineCommentSchema.safeParse(node);
      if (!check.success) {
        return "";
      }
      const strCheck = z.string().safeParse(check.data.comment);
      return strCheck.success ? strCheck.data : "";
    }

    /**
     * Collect all comment sources for a YAML pair (key comment, pair comment, inline comment)
     */
    function collectItemComment(
      pairData: { keyNode: unknown; item: unknown; valueNode: unknown },
      context: { index: number; mapComment: string },
    ): string {
      let comment = extractCommentBefore(pairData.keyNode);
      const pairComment = extractCommentBefore(pairData.item);
      if (pairComment) {
        comment = comment ? `${pairComment}\n${comment}` : pairComment;
      }
      const inlineComment = extractInlineComment(pairData.valueNode);
      if (inlineComment) {
        comment = comment ? `${comment}\n${inlineComment}` : inlineComment;
      }
      // First item inherits map comment if it has none
      if (context.index === 0 && !comment && context.mapComment) {
        comment = context.mapComment;
      }
      if (comment) {
        comment = filterCommentedOutYAML(comment);
      }
      return comment;
    }

    /**
     * Store a comment (with @param handling) into the comments map
     */
    function storeComment(comment: string, fullKey: string): void {
      const hasParamDirective = comment.includes("@param ");
      if (hasParamDirective) {
        const { params, remainingLines } = parseBitnamiParams(comment);
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
        const remainingCleaned =
          remainingLines.length > 0
            ? cleanYAMLComment(remainingLines.join("\n"))
            : "";
        if (remainingCleaned) {
          comments.set(fullKey, {
            text: remainingCleaned,
            metadata: {
              source: "AST",
              rawComment: comment,
              debugInfo: `AST comment after extracting @param directives`,
            },
          });
        }
      } else if (comment) {
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

    // Recursively walk the YAML AST and extract comments
    function visitNode(
      node: unknown,
      keyPath: string[] = [],
      inheritedComment = "",
    ): void {
      if (node == null) {
        return;
      }

      const mapNodeCheck = MapNodeSchema.safeParse(node);
      if (!mapNodeCheck.success) {
        return;
      }

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
        const itemCheck = PairSchema.safeParse(item);
        if (!itemCheck.success) {
          continue;
        }

        const keyNodeCheck = KeyValueSchema.safeParse(itemCheck.data.key);
        if (!keyNodeCheck.success) {
          continue;
        }

        const key = keyNodeCheck.data.value;
        const newPath = [...keyPath, key];
        const fullKey = newPath.join(".");

        const comment = collectItemComment(
          {
            keyNode: itemCheck.data.key,
            item,
            valueNode: itemCheck.data.value,
          },
          { index: i, mapComment },
        );
        storeComment(comment, fullKey);

        const valueInheritedComment = extractCommentBefore(
          itemCheck.data.value,
        );

        if (itemCheck.data.value != null) {
          visitNode(itemCheck.data.value, newPath, valueInheritedComment);
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
