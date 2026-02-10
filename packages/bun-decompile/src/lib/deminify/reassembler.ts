import { validateSource } from "./ast-parser.ts";
import type { CallGraph, DeminifyResult } from "./types.ts";

/** Replacement to apply to source */
type Replacement = {
  start: number;
  end: number;
  originalText: string;
  newText: string;
  functionId: string;
}

/** Reassemble de-minified functions back into complete source */
export function reassemble(
  originalSource: string,
  graph: CallGraph,
  results: Map<string, DeminifyResult>,
): string {
  // Build list of replacements from results
  const replacements: Replacement[] = [];

  for (const [funcId, result] of results) {
    const func = graph.functions.get(funcId);
    if (!func) {continue;}

    // Only replace top-level functions (not nested)
    // Nested functions are already included in their parent's de-minified output
    if (func.parentId) {continue;}

    replacements.push({
      start: func.start,
      end: func.end,
      originalText: func.source,
      newText: result.deminifiedSource,
      functionId: funcId,
    });
  }

  // Sort replacements by position (descending) to maintain offset correctness
  replacements.sort((a, b) => b.start - a.start);

  // Apply replacements
  let source = originalSource;
  for (const replacement of replacements) {
    source =
      source.slice(0, replacement.start) +
      replacement.newText +
      source.slice(replacement.end);
  }

  // Build global name map from all results
  const nameMap = buildNameMap(results, graph);

  // Update remaining identifier references
  source = updateReferences(source, nameMap, replacements);

  // Format the output
  source = formatOutput(source);

  return source;
}

/** Build a map of original names to suggested names */
function buildNameMap(
  results: Map<string, DeminifyResult>,
  graph: CallGraph,
): Map<string, string> {
  const nameMap = new Map<string, string>();

  for (const [funcId, result] of results) {
    const func = graph.functions.get(funcId);
    if (!func) {continue;}

    // Map function name
    if (func.originalName && result.suggestedName !== func.originalName) {
      nameMap.set(func.originalName, result.suggestedName);
    }

    // Map parameter names
    for (const [orig, suggested] of Object.entries(result.parameterNames)) {
      if (orig !== suggested) {
        nameMap.set(orig, suggested);
      }
    }

    // Map local variable names
    for (const [orig, suggested] of Object.entries(result.localVariableNames)) {
      if (orig !== suggested) {
        nameMap.set(orig, suggested);
      }
    }
  }

  return nameMap;
}

/** Update identifier references outside of replaced functions */
function updateReferences(
  source: string,
  nameMap: Map<string, string>,
  replacements: Replacement[],
): string {
  if (nameMap.size === 0) {return source;}

  // Get positions that were already replaced (don't double-process)
  const replacedRanges = replacements.map((r) => ({
    start: r.start,
    end: r.start + r.newText.length,
  }));

  // Sort names by length (longest first) to avoid partial replacements
  const sortedNames = [...nameMap.entries()].sort(
    (a, b) => b[0].length - a[0].length,
  );

  // For each name, find and replace occurrences outside replaced ranges
  for (const [original, suggested] of sortedNames) {
    // Skip single-character names to avoid too many false positives
    if (original.length === 1) {continue;}

    // Create regex that matches whole words only
    const regex = new RegExp(String.raw`\b${escapeRegex(original)}\b`, "g");

    let match: RegExpExecArray | null;
    const newParts: string[] = [];
    let lastIndex = 0;

    // Reset regex state
    regex.lastIndex = 0;

    while ((match = regex.exec(source)) !== null) {
      const matchStart = match.index;
      const matchEnd = matchStart + match[0].length;

      // Check if this match is inside a replaced range
      const isInReplaced = replacedRanges.some(
        (r) => matchStart >= r.start && matchEnd <= r.end,
      );

      if (!isInReplaced) {
        // Not in a replaced range, apply the mapping
        newParts.push(source.slice(lastIndex, matchStart));
        newParts.push(suggested);
        lastIndex = matchEnd;
      }
    }

    if (newParts.length > 0) {
      newParts.push(source.slice(lastIndex));
      source = newParts.join("");

      // Update replaced ranges after modification
      // This is approximate but helps prevent issues
    }
  }

  return source;
}

/** Escape special regex characters */
function escapeRegex(str: string): string {
  return str.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/** Format the final output with consistent style */
export function formatOutput(source: string): string {
  // Basic formatting rules:
  // 1. Ensure newlines after semicolons at statement level
  // 2. Ensure newlines after opening braces
  // 3. Add blank lines between top-level declarations

  // Try to parse and verify the source is valid
  if (!validateSource(source)) {
    // If parsing fails, return as-is
    return source;
  }

  // Simple formatting: ensure consistent line endings
  let formatted = source
    // Normalize line endings
    .replaceAll('\r\n', "\n")
    // Remove trailing whitespace
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    // Ensure file ends with newline
    .trimEnd() + "\n";

  // Add blank line between top-level functions/declarations
  formatted = formatted.replaceAll(
    /(\n\})\n((?:export\s+)?(?:async\s+)?function\s+)/g,
    "$1\n\n$2",
  );
  formatted = formatted.replaceAll(
    /(\n\})\n((?:export\s+)?(?:const|let|var)\s+)/g,
    "$1\n\n$2",
  );
  formatted = formatted.replaceAll(
    /(\n\})\n((?:export\s+)?class\s+)/g,
    "$1\n\n$2",
  );

  return formatted;
}

/** Verify the reassembled code parses correctly */
export function verifyReassembly(source: string): boolean {
  return validateSource(source);
}

/** Get statistics about the reassembly */
export function getReassemblyStats(
  originalSource: string,
  reassembledSource: string,
  results: Map<string, DeminifyResult>,
): {
  originalSize: number;
  reassembledSize: number;
  sizeIncrease: number;
  functionsReplaced: number;
  namesUpdated: number;
} {
  let namesUpdated = 0;
  for (const result of results.values()) {
    if (result.suggestedName) {namesUpdated++;}
    namesUpdated += Object.keys(result.parameterNames).length;
    namesUpdated += Object.keys(result.localVariableNames).length;
  }

  return {
    originalSize: originalSource.length,
    reassembledSize: reassembledSource.length,
    sizeIncrease: reassembledSource.length - originalSource.length,
    functionsReplaced: results.size,
    namesUpdated,
  };
}

/** Create a diff-friendly view of changes */
export function createChangeSummary(
  graph: CallGraph,
  results: Map<string, DeminifyResult>,
): string {
  const lines: string[] = [];

  lines.push("# De-minification Summary\n");

  // Function name changes
  const nameChanges: { original: string; suggested: string; confidence: number }[] = [];
  for (const [funcId, result] of results) {
    const func = graph.functions.get(funcId);
    if (!func) {continue;}

    if (func.originalName && result.suggestedName !== func.originalName) {
      nameChanges.push({
        original: func.originalName,
        suggested: result.suggestedName,
        confidence: result.confidence,
      });
    }
  }

  if (nameChanges.length > 0) {
    lines.push("## Function Renames");
    lines.push("| Original | Suggested | Confidence |");
    lines.push("|----------|-----------|------------|");
    for (const change of nameChanges.sort((a, b) => b.confidence - a.confidence)) {
      lines.push(
        `| \`${change.original}\` | \`${change.suggested}\` | ${(change.confidence * 100).toFixed(0)}% |`,
      );
    }
    lines.push("");
  }

  // Confidence distribution
  const confidences = [...results.values()].map((r) => r.confidence);
  if (confidences.length > 0) {
    const avg = confidences.reduce((a, b) => a + b, 0) / confidences.length;
    const min = Math.min(...confidences);
    const max = Math.max(...confidences);

    lines.push("## Confidence Statistics");
    lines.push(`- Average: ${(avg * 100).toFixed(1)}%`);
    lines.push(`- Min: ${(min * 100).toFixed(1)}%`);
    lines.push(`- Max: ${(max * 100).toFixed(1)}%`);
    lines.push("");
  }

  return lines.join("\n");
}
