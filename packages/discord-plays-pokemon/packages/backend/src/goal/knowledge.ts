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
const COVERAGE_TERM_SCORE = 15;
const PROXIMITY_MAX_SCORE = 30;
const PROXIMITY_MAX_SPAN = 600;

type AcquisitionEvidence = Readonly<{
  score: number;
  position: number;
}>;

type PassageEvidence = Readonly<{
  score: number;
  position: number;
}>;

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
    const normalizedPassage = normalize(passage);
    const positions = queryTerms
      .map((term) => normalizedPassage.indexOf(term))
      .filter((termPosition) => termPosition >= 0);
    const coverage = positions.length;
    if (coverage === 0) continue;
    const span =
      coverage === 1
        ? PROXIMITY_MAX_SPAN
        : Math.max(...positions) - Math.min(...positions);
    const proximityScore =
      coverage < 2
        ? 0
        : Math.round(
            PROXIMITY_MAX_SCORE * Math.max(0, 1 - span / PROXIMITY_MAX_SPAN),
          );
    const score = coverage * COVERAGE_TERM_SCORE + proximityScore;
    if (best === undefined || score > best.score) {
      best = { score, position };
    }
  }
  return best;
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

function excerpt(
  body: string,
  queryTerms: readonly string[],
  preferredPosition?: number,
): string {
  const normalizedBody = normalize(body);
  const positions = queryTerms
    .map((term) => normalizedBody.indexOf(term))
    .filter((position) => position >= 0);
  const first = preferredPosition ?? Math.min(...positions);
  const start = Number.isFinite(first) ? Math.max(0, first - 200) : 0;
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
        const preferredEvidence = acquisition ?? passage;
        return {
          record,
          preferredEvidence,
          score: scoreRecord(
            record,
            queryTerms,
            (passage?.score ?? 0) + (acquisition?.score ?? 0),
          ),
        };
      })
      .filter((candidate) => candidate.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.record.title.localeCompare(right.record.title),
      )
      .slice(0, options.limit)
      .map(({ record, score, preferredEvidence }) => ({
        id: record.id,
        domain: record.domain,
        title: record.title,
        excerpt: excerpt(record.body, queryTerms, preferredEvidence?.position),
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
