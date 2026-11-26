/**
 * Text rules shared by tips and glossary definitions. Tips state facts and
 * advice only (the Scout copy rule): no statistics, no lead-ins that explain
 * the tip, and every number grounded in a cited ability value. A percentage is
 * an ability value too ("slows by 65%") when it matches a cited value, stored
 * either as a ratio (`-0.65`) or in percent (`65`); any other percentage is a
 * statistic.
 */

export const TIP_MAX_SENTENCES = 2;

/**
 * A tip never cites statistics; those belong to the numbers sections. A
 * percentage attached to a number is judged against the cites instead.
 */
const STATISTIC_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/(?<!\d\s?)%/u, "a percentage"],
  [/(?<!\d\s?)\bper ?cent/iu, "a percentage"],
  [/\bwin ?rates?\b/iu, "a win rate"],
  [/\b(?:pick|ban) ?rates?\b/iu, "a pick or ban rate"],
  [/\bgames\b/iu, "a game count"],
  [/\bstatistic(?:s|al|ally)?\b/iu, "statistics"],
  [/\bodds\b/iu, "odds"],
];

/** Sentence openers that explain instead of advise (COPY.md). */
const LEAD_IN_PATTERNS: readonly RegExp[] = [
  /^here(?:'s| is| are)\b/iu,
  /^remember\b/iu,
  /^it(?:'s| is) (?:important|crucial|key|vital|essential)\b/iu,
  /^note that\b/iu,
  /^keep in mind\b/iu,
  /^(?:don't|do not) forget\b/iu,
  /^pro tip\b/iu,
  /^tip:/iu,
  /^that(?:'s| is)\b/iu,
  /^in this matchup\b/iu,
  /^as you can see\b/iu,
  /^(?:basically|essentially|overall|in general|generally)\b/iu,
];

export type TextIssue = {
  code: "length" | "sentences" | "statistic" | "lead-in" | "uncited-number";
  message: string;
};

/** Curly apostrophes and quotes as their ASCII forms, so one pattern set applies. */
export function normalizeQuotes(text: string): string {
  return text.replaceAll(/[‘’]/gu, "'").replaceAll(/[“”]/gu, '"');
}

/** Sentences split on terminal punctuation followed by a space or the end. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

export type NumberToken = { text: string; value: number; index: number };

export function findNumbers(text: string): NumberToken[] {
  return [...text.matchAll(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/gu)].map(
    (match) => ({
      text: match[0],
      value: Number(match[0].replaceAll(",", "")),
      index: match.index,
    }),
  );
}

function isLevelNumber(text: string, token: NumberToken): boolean {
  return /\blevel\s+$/iu.test(text.slice(0, token.index));
}

function isPercentage(text: string, token: NumberToken): boolean {
  return /^\s?(?:%|per ?cent\b)/iu.test(
    text.slice(token.index + token.text.length),
  );
}

function sameNumber(left: number, right: number): boolean {
  return Math.abs(left - right) < 1e-6;
}

/** A cited value written as a percentage: a ratio (`-0.65`) or already in percent (`65`). */
function matchesPercentage(cited: number, percent: number): boolean {
  return (
    sameNumber(Math.abs(cited) * 100, percent) ||
    sameNumber(Math.abs(cited), percent)
  );
}

function numberIssues(
  text: string,
  citedNumbers: readonly number[],
): TextIssue[] {
  return findNumbers(text).flatMap((token): TextIssue[] => {
    if (isLevelNumber(text, token)) {
      return [];
    }
    if (isPercentage(text, token)) {
      return citedNumbers.some((value) => matchesPercentage(value, token.value))
        ? []
        : [
            {
              code: "statistic",
              message: `"${token.text}%" is a percentage that is not a cited ability value`,
            },
          ];
    }
    return citedNumbers.some((value) => sameNumber(value, token.value))
      ? []
      : [
          {
            code: "uncited-number",
            message: `"${token.text}" is not a cited ability value or a level`,
          },
        ];
  });
}

export function validateText(
  rawText: string,
  options: { maxLength: number; citedNumbers: readonly number[] },
): TextIssue[] {
  const text = normalizeQuotes(rawText);
  const issues: TextIssue[] = [];
  if (text.length > options.maxLength) {
    issues.push({
      code: "length",
      message: `${text.length.toString()} characters, over the ${options.maxLength.toString()} limit`,
    });
  }
  const sentences = splitSentences(text);
  if (sentences.length > TIP_MAX_SENTENCES) {
    issues.push({
      code: "sentences",
      message: `${sentences.length.toString()} sentences, over the ${TIP_MAX_SENTENCES.toString()} limit`,
    });
  }
  for (const [pattern, label] of STATISTIC_PATTERNS) {
    const found = pattern.exec(text);
    if (found !== null) {
      issues.push({
        code: "statistic",
        message: `cites ${label} ("${found[0]}")`,
      });
    }
  }
  for (const sentence of sentences) {
    const leadIn = LEAD_IN_PATTERNS.find((pattern) => pattern.test(sentence));
    if (leadIn !== undefined) {
      issues.push({
        code: "lead-in",
        message: `opens with an explanatory lead-in: "${sentence.slice(0, 30)}"`,
      });
    }
  }
  issues.push(...numberIssues(text, options.citedNumbers));
  return issues;
}

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "before",
  "but",
  "by",
  "can",
  "do",
  "for",
  "from",
  "her",
  "him",
  "his",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "not",
  "of",
  "on",
  "only",
  "or",
  "she",
  "so",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "they",
  "this",
  "to",
  "until",
  "when",
  "with",
  "you",
  "your",
]);

function contentWords(text: string): Set<string> {
  return new Set(
    normalizeQuotes(text)
      .toLowerCase()
      .split(/[^\p{L}\p{N}']+/u)
      .map((word) => word.replace(/'s$/u, "").replace(/s$/u, ""))
      .filter((word) => word.length > 1 && !STOPWORDS.has(word)),
  );
}

/** Jaccard similarity of the two texts' content words, 0 to 1. */
export function tipSimilarity(left: string, right: string): number {
  const leftWords = contentWords(left);
  const rightWords = contentWords(right);
  if (leftWords.size === 0 || rightWords.size === 0) {
    return 0;
  }
  const shared = [...leftWords].filter((word) => rightWords.has(word)).length;
  return shared / (leftWords.size + rightWords.size - shared);
}

export const NEAR_DUPLICATE_SIMILARITY = 0.6;
