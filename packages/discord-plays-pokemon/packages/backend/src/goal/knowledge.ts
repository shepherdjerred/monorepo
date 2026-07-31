import path from "node:path";
import { z } from "zod";

export const KnowledgeDomainSchema = z.enum([
  "world",
  "progression",
  "species",
  "items",
  "battle",
]);

const KnowledgeRecordSchema = z.strictObject({
  id: z.string().min(1),
  domain: KnowledgeDomainSchema,
  title: z.string().min(1),
  aliases: z.array(z.string()),
  tags: z.array(z.string()),
  body: z.string().min(1),
  sources: z
    .array(
      z.strictObject({
        id: z.enum([
          "pokeemerald-wasm",
          "archipelago",
          "pokeapi",
          "bulbapedia",
        ]),
        url: z.url(),
        license: z.string().min(1),
        revision: z.string().min(1),
      }),
    )
    .min(1),
});

const KnowledgeRecordsSchema = z.array(KnowledgeRecordSchema);
export type KnowledgeRecord = z.infer<typeof KnowledgeRecordSchema>;
export type KnowledgeDomain = z.infer<typeof KnowledgeDomainSchema>;

export type KnowledgeSearchResult = {
  id: string;
  domain: KnowledgeDomain;
  title: string;
  excerpt: string;
  sources: KnowledgeRecord["sources"];
  score: number;
};

const SEARCH_EXCERPT_CHARS = 1200;
const GET_BODY_CHARS = 8000;
const SEARCH_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "can",
  "do",
  "for",
  "get",
  "how",
  "i",
  "in",
  "is",
  "of",
  "on",
  "the",
  "to",
  "where",
]);
const ACQUISITION_QUERY_TERMS = new Set([
  "acquire",
  "find",
  "get",
  "obtain",
  "receive",
]);
const ACQUISITION_EVIDENCE_TERMS = new Set([
  "acquire",
  "acquired",
  "award",
  "awarded",
  "awards",
  "gave",
  "give",
  "given",
  "gives",
  "found",
  "hand",
  "handed",
  "hands",
  "obtain",
  "obtained",
  "receive",
  "receives",
  "reward",
  "rewarded",
  "rewards",
]);
const ACQUISITION_EVIDENCE_SCORE = 150;
const HM_ACQUISITION_EVIDENCE_SCORE = 200;
const PROXIMITY_MAX_SCORE = 30;
const COVERAGE_TERM_SCORE = PROXIMITY_MAX_SCORE + 1;
const PROXIMITY_MAX_SPAN = 600;

type AcquisitionEvidence = Readonly<{
  score: number;
  position: number;
}>;

type PassageEvidence = Readonly<{
  score: number;
  span: number;
  start: number;
  end: number;
}>;

type TermOccurrence = Readonly<{
  term: string;
  position: number;
}>;

type MatchingWindow = Readonly<{
  coverage: number;
  span: number;
  start: number;
  end: number;
}>;

type ExcerptAnchor = Readonly<{ start: number; end: number }>;

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replaceAll(/\p{M}+/gu, "")
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function terms(value: string): string[] {
  return [
    ...new Set(
      normalize(value)
        .split(" ")
        .filter((term) => term.length > 1 && !SEARCH_STOPWORDS.has(term)),
    ),
  ];
}

function matchingWindow(
  value: string,
  queryTerms: readonly string[],
): MatchingWindow | undefined {
  const queryTermSet = new Set(queryTerms);
  const termOccurrences: TermOccurrence[] = [];
  for (const match of value.matchAll(/[\p{L}\p{N}]+/gu)) {
    const term = normalize(match[0]);
    if (queryTermSet.has(term)) {
      termOccurrences.push({ term, position: match.index });
    }
    for (const component of term.matchAll(/\p{L}+|\p{N}+/gu)) {
      if (component[0] !== term && queryTermSet.has(component[0])) {
        termOccurrences.push({
          term: component[0],
          position: match.index + component.index,
        });
      }
    }
  }
  if (termOccurrences.length === 0) {
    return undefined;
  }

  const coverage = new Set(termOccurrences.map((occurrence) => occurrence.term))
    .size;
  const counts = new Map<string, number>();
  let coveredTerms = 0;
  let leftIndex = 0;
  let bestSpan = Number.POSITIVE_INFINITY;
  let bestStart = 0;
  let bestEnd = 0;

  for (const right of termOccurrences) {
    const rightCount = counts.get(right.term) ?? 0;
    if (rightCount === 0) {
      coveredTerms += 1;
    }
    counts.set(right.term, rightCount + 1);

    while (coveredTerms === coverage) {
      const left = termOccurrences[leftIndex];
      if (left === undefined) {
        throw new Error("matching window must have a left occurrence");
      }
      const span = right.position - left.position;
      if (span < bestSpan) {
        bestSpan = span;
        bestStart = left.position;
        bestEnd = right.position + right.term.length;
      }
      const leftCount = counts.get(left.term);
      if (leftCount === undefined) {
        throw new Error("matching window must count its left occurrence");
      }
      if (leftCount === 1) {
        counts.delete(left.term);
        coveredTerms -= 1;
      } else {
        counts.set(left.term, leftCount - 1);
      }
      leftIndex += 1;
    }
  }

  return { coverage, span: bestSpan, start: bestStart, end: bestEnd };
}

function occurrences(haystack: string, needle: string): number {
  let count = 0;
  let position = 0;
  for (;;) {
    const match = haystack.indexOf(needle, position);
    if (match === -1) return count;
    count += 1;
    position = match + needle.length;
  }
}

function containsAnyTerm(value: string, candidates: ReadonlySet<string>) {
  return normalize(value)
    .split(" ")
    .some((term) => candidates.has(term));
}

function containsAcquisitionSubjectAnchor(
  value: string,
  queryTerms: readonly string[],
): boolean {
  const valueTerms = new Set(normalize(value).split(" "));
  return queryTerms.some(
    (term) =>
      valueTerms.has(term) ||
      (term === "bike" &&
        (valueTerms.has("bicycle") || valueTerms.has("bicycles"))),
  );
}

function acquisitionEvidence(
  record: KnowledgeRecord,
  queryTerms: readonly string[],
): AcquisitionEvidence | undefined {
  if (record.domain !== "progression") {
    return undefined;
  }
  let bestEvidence: AcquisitionEvidence | undefined;
  let searchFrom = 0;
  for (const passage of record.body.split(/\n{2,}/)) {
    const position = record.body.indexOf(passage, searchFrom);
    if (position === -1) {
      throw new Error("knowledge passage must originate from its record body");
    }
    searchFrom = position + passage.length;
    const normalizedPassage = normalize(passage);
    const passageTerms = new Set(normalizedPassage.split(" "));
    const evidenceSentence = passage
      .split(/[.!?]\s+|\n+/)
      .find(
        (sentence) =>
          containsAnyTerm(sentence, ACQUISITION_EVIDENCE_TERMS) &&
          containsAcquisitionSubjectAnchor(sentence, queryTerms),
      );
    const isRelevantEvidence =
      queryTerms.length > 0 &&
      queryTerms.every((term) => passageTerms.has(term)) &&
      evidenceSentence !== undefined;
    if (!isRelevantEvidence) continue;
    const score = /\bhm\d+\b/u.test(normalizedPassage)
      ? HM_ACQUISITION_EVIDENCE_SCORE
      : ACQUISITION_EVIDENCE_SCORE;
    if (bestEvidence === undefined || score > bestEvidence.score) {
      bestEvidence = {
        score,
        position: position + passage.indexOf(evidenceSentence),
      };
    }
  }
  return bestEvidence;
}

function passageEvidence(
  record: KnowledgeRecord,
  queryTerms: readonly string[],
): PassageEvidence | undefined {
  let best: PassageEvidence | undefined;
  let searchFrom = 0;
  for (const passage of record.body.split(/\n\s*\n/u)) {
    const position = record.body.indexOf(passage, searchFrom);
    if (position === -1) {
      throw new Error("knowledge passage must originate from its record body");
    }
    searchFrom = position + passage.length;
    const window = matchingWindow(passage, queryTerms);
    if (window === undefined) continue;
    const proximityScore =
      window.coverage < 2
        ? 0
        : Math.round(
            PROXIMITY_MAX_SCORE *
              Math.max(0, 1 - window.span / PROXIMITY_MAX_SPAN),
          );
    const score = window.coverage * COVERAGE_TERM_SCORE + proximityScore;
    // Break score ties with the raw span so the closest passage wins even when
    // both spans exceed PROXIMITY_MAX_SPAN and share a clamped proximity of 0.
    const isBetter =
      best === undefined ||
      score > best.score ||
      (score === best.score && window.span < best.span);
    if (isBetter) {
      best = {
        score,
        span: window.span,
        start: position + window.start,
        end: position + window.end,
      };
    }
  }
  return best;
}

// Distinct query terms the record covers anywhere in its searchable text. This
// is the primary ranking key: answering more of the query outranks answering
// less, before any additive relevance, proximity, occurrence, or metadata bonus.
// Coverage uses the same whole-word-plus-component tokenization as
// `matchingWindow`, so `route101` covers both `route` and `101` while `cut`
// inside `shortcut` does not count.
function recordCoverage(
  record: KnowledgeRecord,
  queryTerms: readonly string[],
): number {
  const queryTermSet = new Set(queryTerms);
  const covered = new Set<string>();
  const searchable = `${record.title} ${record.aliases.join(" ")} ${record.tags.join(" ")} ${record.body}`;
  for (const match of searchable.matchAll(/[\p{L}\p{N}]+/gu)) {
    const token = normalize(match[0]);
    if (queryTermSet.has(token)) covered.add(token);
    for (const component of token.matchAll(/\p{L}+|\p{N}+/gu)) {
      if (queryTermSet.has(component[0])) covered.add(component[0]);
    }
  }
  return covered.size;
}

function scoreRecord(
  record: KnowledgeRecord,
  queryTerms: readonly string[],
  evidenceScore: number,
): number {
  const title = normalize(record.title);
  const aliases = normalize(record.aliases.join(" "));
  const tags = normalize(record.tags.join(" "));
  const body = normalize(record.body);
  const relevanceScore = queryTerms.reduce((score, term) => {
    if (title === term) return score + 100;
    if (title.includes(term)) return score + 30;
    if (aliases.includes(term)) return score + 20;
    if (tags.includes(term)) return score + 10;
    const bodyOccurrences = occurrences(body, term);
    if (bodyOccurrences > 0) {
      return score + Math.min(bodyOccurrences, 10) * 2;
    }
    return score;
  }, 0);
  return relevanceScore + evidenceScore;
}

const EXCERPT_PAD_CHARS = 200;

// Bias the excerpt toward leading context, but when the matching window is too
// wide to keep its right edge inside the fixed-width slice, shift right so the
// later matched term stays visible instead of being dropped.
function excerptStart(range: ExcerptAnchor): number {
  let start = range.start - EXCERPT_PAD_CHARS;
  if (range.end + EXCERPT_PAD_CHARS > start + SEARCH_EXCERPT_CHARS) {
    start = range.end + EXCERPT_PAD_CHARS - SEARCH_EXCERPT_CHARS;
  }
  return Math.max(0, start);
}

function excerpt(
  body: string,
  queryTerms: readonly string[],
  anchor?: ExcerptAnchor,
): string {
  const window = anchor ?? matchingWindow(body, queryTerms);
  const range: ExcerptAnchor = window ?? { start: 0, end: 0 };
  const start = excerptStart(range);
  const sliced = body.slice(start, start + SEARCH_EXCERPT_CHARS);
  return `${start > 0 ? "…" : ""}${sliced}${start + sliced.length < body.length ? "…" : ""}`;
}

export class KnowledgeBase {
  readonly #records: readonly KnowledgeRecord[];
  readonly #byId: ReadonlyMap<string, KnowledgeRecord>;

  constructor(records: readonly KnowledgeRecord[]) {
    this.#records = records;
    this.#byId = new Map(records.map((record) => [record.id, record]));
    if (this.#byId.size !== records.length) {
      throw new Error("knowledge record IDs must be unique");
    }
  }

  search(
    query: string,
    options: { domain?: KnowledgeDomain; limit: number },
  ): KnowledgeSearchResult[] {
    const acquisitionIntent = containsAnyTerm(query, ACQUISITION_QUERY_TERMS);
    const queryTerms = terms(query).filter(
      (term) => !acquisitionIntent || !ACQUISITION_QUERY_TERMS.has(term),
    );
    if (queryTerms.length === 0) {
      throw new Error("knowledge query must contain searchable text");
    }
    return this.#records
      .filter(
        (record) =>
          options.domain === undefined || record.domain === options.domain,
      )
      .map((record) => {
        const acquisition = acquisitionIntent
          ? acquisitionEvidence(record, queryTerms)
          : undefined;
        const passage = passageEvidence(record, queryTerms);
        const anchor: ExcerptAnchor | undefined =
          acquisition === undefined
            ? passage === undefined
              ? undefined
              : { start: passage.start, end: passage.end }
            : { start: acquisition.position, end: acquisition.position };
        return {
          record,
          anchor,
          coverage: recordCoverage(record, queryTerms),
          score: scoreRecord(
            record,
            queryTerms,
            (passage?.score ?? 0) + (acquisition?.score ?? 0),
          ),
        };
      })
      .filter((candidate) => candidate.score > 0)
      .sort(
        // Coverage before the additive score so complete query-term coverage
        // always outranks a partial match's proximity/occurrence/metadata bonus.
        (left, right) =>
          right.coverage - left.coverage ||
          right.score - left.score ||
          left.record.title.localeCompare(right.record.title),
      )
      .slice(0, options.limit)
      .map(({ record, score, anchor }) => ({
        id: record.id,
        domain: record.domain,
        title: record.title,
        excerpt: excerpt(record.body, queryTerms, anchor),
        sources: record.sources,
        score,
      }));
  }

  get(id: string): KnowledgeRecord | undefined {
    const record = this.#byId.get(id);
    if (record === undefined) {
      return undefined;
    }
    return {
      ...record,
      body:
        record.body.length <= GET_BODY_CHARS
          ? record.body
          : `${record.body.slice(0, GET_BODY_CHARS)}…`,
    };
  }
}

function knowledgeRoot(): string {
  return (
    Bun.env["POKEMON_KNOWLEDGE_ROOT"] ??
    path.resolve(import.meta.dir, "../../../..", "knowledge")
  );
}

async function loadRecords(filePath: string): Promise<KnowledgeRecord[]> {
  return KnowledgeRecordsSchema.parse(await Bun.file(filePath).json());
}

let knowledgeBasePromise: Promise<KnowledgeBase> | undefined;

async function createKnowledgeBase(): Promise<KnowledgeBase> {
  const [generated, shareAlike] = await Promise.all([
    loadRecords(path.join(knowledgeRoot(), "generated", "records.json")),
    loadRecords(
      path.join(knowledgeRoot(), "cc-by-nc-sa-2.5", "walkthrough.json"),
    ),
  ]);
  return new KnowledgeBase([...generated, ...shareAlike]);
}

export function loadKnowledgeBase(): Promise<KnowledgeBase> {
  knowledgeBasePromise ??= createKnowledgeBase();
  return knowledgeBasePromise;
}
