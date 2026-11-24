import { z } from "zod";
import type { ReviewProvider } from "../types.ts";

export const CODEANT_LOGIN = "codeant-ai";

const CODEANT_STATUS_MARKER = "<!-- codeant-review-status:";

const CodeantStatusSchema = z.array(
  z
    .object({
      commit: z.string().regex(/^[0-9a-f]{7,40}$/iu),
      done: z.boolean(),
    })
    .loose(),
);

/**
 * CodeAnt inline findings carry an explicit `**Assessment:**` or
 * `**Severity Level:**` label followed (after optional whitespace, emoji, or
 * backticks on the same line) by `Blocker`, `Critical`, `Major`, `Minor`, or
 * `Info`. Anchoring to the bold field label prevents prose words like "major"
 * or "minor" from triggering false matches.
 */
const CODEANT_SEVERITY_RE =
  /\*\*(?:Assessment|Severity Level)(?::\*\*|\*\*:)[^\p{L}\p{N}\r\n]*(Blocker|Critical|Major|Minor|Info)\b/iu;

const CODEANT_PRIORITIES: Readonly<Record<string, number>> = {
  blocker: 0,
  critical: 0,
  major: 1,
  minor: 2,
  info: 3,
};

export function parseCodeantSeverity(body: string | null): number | null {
  if (body === null) {
    return null;
  }
  const match = CODEANT_SEVERITY_RE.exec(body);
  const label = match?.[1]?.toLowerCase();
  return label === undefined ? null : (CODEANT_PRIORITIES[label] ?? null);
}

/**
 * Extract the headline from a CodeAnt inline comment: the first line/sentence
 * after `**Suggestion:**` (up to `\n`), trimmed, or `null`.
 */
export function parseCodeantFindingTitle(body: string | null): string | null {
  if (body === null) {
    return null;
  }
  const match = /\*\*Suggestion(?::\*\*|\*\*:)[ \t]*([^\r\n]*)/iu.exec(body);
  if (match === null) {
    return null;
  }
  const inline = match[1]?.trim() ?? "";
  if (inline !== "") {
    return inline;
  }
  const after = body.slice(match.index + match[0].length);
  for (const rawLine of after.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === "") {
      continue;
    }
    return line.startsWith("```") || /^<details\b/iu.test(line) ? null : line;
  }
  return null;
}

/**
 * Extract the last completed (`done === true`) commit SHA from CodeAnt's
 * `<!-- codeant-review-status:[...] -->` status issue comment, returning its
 * lowercase SHA or `null` when missing, malformed, incomplete, or carrying a
 * finding severity badge.
 */
export function parseCodeantCleanHead(body: string): string | null {
  if (parseCodeantSeverity(body) !== null) {
    return null;
  }
  const matches = [
    ...body.matchAll(/<!-- codeant-review-status:([\s\S]*?) -->/gu),
  ];
  if (matches.length !== 1) {
    return null;
  }
  const encoded = matches[0]?.[1];
  if (encoded === undefined) {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(encoded);
  } catch {
    return null;
  }
  const parsed = CodeantStatusSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  for (let index = parsed.data.length - 1; index >= 0; index--) {
    const entry = parsed.data[index];
    if (entry?.done === true) {
      return entry.commit.toLowerCase();
    }
  }
  return null;
}

/**
 * CodeAnt AI (`codeant-ai` GitHub App).
 *
 * Completion: CodeAnt posts `COMMENTED` reviews for inline findings and updates
 * a status issue comment carrying `<!-- codeant-review-status:[...] -->` with
 * each run's `commit` and `done` flag.
 */
export const codeantProvider: ReviewProvider = {
  id: "codeant",
  displayName: "CodeAnt AI",
  startsReviewOnPush: false,
  botAuthoredPullRequestPolicy: "review",
  authorLogins: [CODEANT_LOGIN],
  parseSeverity: parseCodeantSeverity,
  parseFindingTitle: parseCodeantFindingTitle,
  findingKey: null,
  parseReviewBodyFindings: null,
  completion: {
    kind: "review-at-head",
    cleanSignal: {
      marker: CODEANT_STATUS_MARKER,
      parseReviewedHead: parseCodeantCleanHead,
    },
  },
  detectSkip: null,
  detectBlocked: [
    {
      matches: ["rate limit"],
      reason: "usage-limited",
      remediation: "Wait for CodeAnt review limit to reset",
    },
    {
      matches: ["limit reached"],
      reason: "usage-limited",
      remediation: "Wait for CodeAnt review limit to reset",
    },
  ],
  requestReview: { command: "@codeant-ai: review" },
};
