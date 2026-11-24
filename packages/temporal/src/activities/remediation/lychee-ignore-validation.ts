const LITERAL_HOST_EXCLUSION_PATTERN =
  /^\^https\?:\/\/[a-z0-9-]+(?:\\\.[a-z0-9-]+)+(?::\d+)?\/(\S+)$/iu;
const BROAD_PATH_PREFIX_PATTERN =
  /^(?:\.\*|\.\+|\(\?:\.\*\)|\(\?:\.\+\))(?:$|\$)/u;
const SENTINEL_UNRELATED_URLS = [
  "https://sentinel-unrelated-host.example/path",
  "http://sentinel-other-host.invalid/docs",
] as const;

function isMeaningfulCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("#") && trimmed.slice(1).trim().length >= 5;
}

function isSpecificValidExclusionRegex(pattern: string): boolean {
  if (pattern.includes("|")) {
    return false;
  }
  const match = LITERAL_HOST_EXCLUSION_PATTERN.exec(pattern);
  const pathPart = match?.[1];
  if (pathPart === undefined || BROAD_PATH_PREFIX_PATTERN.test(pathPart)) {
    return false;
  }
  try {
    // Validate regex syntax deterministically and verify it cannot match unrelated hosts.
    const compiled = new RegExp(pattern, "u");
    return SENTINEL_UNRELATED_URLS.every((url) => !compiled.test(url));
  } catch {
    return false;
  }
}

function parseRuleSet(text: string): Set<string> {
  return new Set(
    text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#")),
  );
}

function validateAddedRule(
  rule: string,
  blockHasComment: boolean,
): string | undefined {
  if (!blockHasComment) {
    return `New .lycheeignore rule '${rule}' lacks a preceding '# <reason>' comment line.`;
  }
  return isSpecificValidExclusionRegex(rule)
    ? undefined
    : `New .lycheeignore rule '${rule}' must be a valid host-specific ^https?:// regex without broad wildcards.`;
}

export function validateLycheeIgnoreChanges(
  beforeText: string,
  afterText: string,
): { valid: boolean; reason?: string } {
  const beforeRules = parseRuleSet(beforeText);
  const afterRules = new Set<string>();
  let blockHasComment = false;

  for (const rawLine of afterText.split(/\r?\n/u)) {
    const trimmed = rawLine.trim();
    if (trimmed === "") {
      blockHasComment = false;
      continue;
    }
    if (trimmed.startsWith("#")) {
      blockHasComment ||= isMeaningfulCommentLine(trimmed);
      continue;
    }
    afterRules.add(trimmed);
    if (beforeRules.has(trimmed)) {
      continue;
    }
    const violation = validateAddedRule(trimmed, blockHasComment);
    if (violation !== undefined) {
      return { valid: false, reason: violation };
    }
  }

  for (const existingRule of beforeRules) {
    if (!afterRules.has(existingRule)) {
      return {
        valid: false,
        reason: `Existing .lycheeignore rule '${existingRule}' was removed.`,
      };
    }
  }

  return { valid: true };
}
