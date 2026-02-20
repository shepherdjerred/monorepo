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
 */

/** State for preprocessing YAML comments */
type PreprocessState = {
  inExampleBlock: boolean;
  inBlockScalar: boolean;
  lastRealKeyIndent: number;
  consecutiveCommentedKeys: number;
};

/**
 * Check if a line is an "Example:" marker
 */
function isExampleMarker(trimmed: string): boolean {
  return /^##?\s*Example:?$/i.test(trimmed);
}

/**
 * Check if an example block should end
 */
function shouldExitExampleBlock(trimmed: string): boolean {
  return (
    !trimmed ||
    trimmed.startsWith("For more information") ||
    trimmed.startsWith("Ref:")
  );
}

/**
 * Check if the previous line had a block scalar indicator
 */
function prevLineHasBlockScalar(lines: string[], i: number): boolean {
  if (i <= 0) {
    return false;
  }
  const prevTrimmed = lines[i - 1]?.trim() ?? "";
  return /^#+\s*[\w.-]+:\s*[|>]\s*$/.test(prevTrimmed);
}

/**
 * Check if a line is still in a block scalar (indented content)
 */
function isBlockScalarContent(line: string, trimmed: string): boolean {
  if (trimmed.length === 0) {
    return false;
  }
  return (
    line.startsWith("  ") || line.startsWith("\t") || /^#\s{2,}/.test(line)
  );
}

/**
 * Check if a commented key value looks like it should be excluded
 */
function isExcludedCommentedKey(keyValue: string): boolean {
  const isDocReference =
    /^ref:/i.test(keyValue) &&
    (keyValue.includes("http://") || keyValue.includes("https://"));
  const isURL =
    keyValue.trim().startsWith("http://") ||
    keyValue.trim().startsWith("https://");
  return isDocReference || isURL;
}

/**
 * Determine if a commented key looks like a YAML example based on context
 */
function isLikelyExample(lines: string[], i: number): boolean {
  const prevLine = i > 0 ? lines[i - 1] : "";
  const prevTrimmed = prevLine?.trim() ?? "";
  const prevIsCommentedKey = /^#+\s*[\w.-]+:\s/.test(prevTrimmed);
  const prevIsBlank = !prevTrimmed;
  const prevIsListItem =
    prevTrimmed.startsWith("#") && prevTrimmed.slice(1).trim().startsWith("-");

  return (
    (!prevIsBlank && !prevIsCommentedKey && prevTrimmed.startsWith("#")) ||
    prevIsListItem
  );
}

/**
 * Update consecutive commented key count based on context
 */
function updateConsecutiveCount(
  lines: string[],
  i: number,
  current: number,
): number {
  const prevLine = i > 0 ? lines[i - 1] : "";
  const prevTrimmed = prevLine?.trim() ?? "";
  const prevIsCommentedKey = /^#+\s*[\w.-]+:\s/.test(prevTrimmed);
  const prevIsBlank = !prevTrimmed;

  if (prevIsCommentedKey) {
    return current + 1;
  }
  if (!prevIsBlank) {
    return 0;
  }
  return current;
}

/**
 * Try to uncomment a commented YAML key line. Returns the uncommented line or null.
 */
function tryUncommentLine(
  line: string,
  lines: string[],
  i: number,
  state: PreprocessState,
): { uncommented: string | null; newConsecutive: number } {
  const commentedKeyMatch = /^([ \t]*)#+\s*([\w.-]+:\s*(?:\S.*)?)$/.exec(line);
  if (!commentedKeyMatch) {
    return { uncommented: null, newConsecutive: 0 };
  }

  const [, indent, keyValue] = commentedKeyMatch;
  if (keyValue == null || keyValue === "" || indent == null || indent === "") {
    return {
      uncommented: null,
      newConsecutive: state.consecutiveCommentedKeys,
    };
  }

  const keyPart = keyValue.split(":")[0]?.trim() ?? "";
  const isValidKey = /^[\w.-]+$/.test(keyPart);

  if (!isValidKey || isExcludedCommentedKey(keyValue)) {
    return {
      uncommented: null,
      newConsecutive: state.consecutiveCommentedKeys,
    };
  }

  const keyIndent = indent.length;
  const newConsecutive = updateConsecutiveCount(
    lines,
    i,
    state.consecutiveCommentedKeys,
  );
  const likelyExampleCtx = isLikelyExample(lines, i);

  const shouldUncomment =
    !likelyExampleCtx &&
    (state.lastRealKeyIndent === -1 ||
      Math.abs(keyIndent - state.lastRealKeyIndent) <= 4 ||
      newConsecutive >= 2);

  if (shouldUncomment) {
    return { uncommented: `${indent}${keyValue}`, newConsecutive };
  }

  return { uncommented: null, newConsecutive };
}

export function preprocessYAMLComments(yamlContent: string): string {
  const lines = yamlContent.split("\n");
  const processedLines: string[] = [];
  const state: PreprocessState = {
    inExampleBlock: false,
    inBlockScalar: false,
    lastRealKeyIndent: -1,
    consecutiveCommentedKeys: 0,
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (isExampleMarker(trimmed)) {
      state.inExampleBlock = true;
      processedLines.push(line);
      continue;
    }

    if (state.inExampleBlock && shouldExitExampleBlock(trimmed)) {
      state.inExampleBlock = false;
    }

    if (prevLineHasBlockScalar(lines, i)) {
      state.inBlockScalar = true;
    }

    if (state.inBlockScalar && !isBlockScalarContent(line, trimmed)) {
      state.inBlockScalar = false;
    }

    if (!trimmed.startsWith("#") && /^[\w.-]+:/.test(trimmed)) {
      state.lastRealKeyIndent = line.search(/\S/);
      state.consecutiveCommentedKeys = 0;
    }

    if (state.inExampleBlock || state.inBlockScalar) {
      processedLines.push(line);
      state.consecutiveCommentedKeys = 0;
      continue;
    }

    const { uncommented, newConsecutive } = tryUncommentLine(
      line,
      lines,
      i,
      state,
    );
    state.consecutiveCommentedKeys = newConsecutive;

    if (uncommented != null) {
      processedLines.push(uncommented);
      continue;
    }

    // Reset consecutive count if not a commented key
    const isCommentedKey = /^[ \t]*#+\s*[\w.-]+:\s*(?:\S.*)?$/.test(line);
    if (!isCommentedKey) {
      state.consecutiveCommentedKeys = 0;
    }

    processedLines.push(line);
  }

  return processedLines.join("\n");
}
