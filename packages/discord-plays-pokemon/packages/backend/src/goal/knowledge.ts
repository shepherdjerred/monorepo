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
  "where",
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
  "hand",
  "handed",
  "hands",
  "obtain",
  "obtained",
  "receive",
  "received",
  "receives",
  "reward",
  "rewarded",
  "rewards",
]);
const ACQUISITION_EVIDENCE_SCORE = 50;
const HM_ACQUISITION_EVIDENCE_SCORE = 100;

type AcquisitionEvidence = Readonly<{
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

function acquisitionEvidence(
  record: KnowledgeRecord,
  queryTerms: readonly string[],
): AcquisitionEvidence | undefined {
  let bestEvidence: AcquisitionEvidence | undefined;
  let searchFrom = 0;
  for (const sentence of record.body.split(/[.!?]\s+|\n+/)) {
    const position = record.body.indexOf(sentence, searchFrom);
    if (position === -1) {
      throw new Error("knowledge sentence must originate from its record body");
    }
    searchFrom = position + sentence.length;
    const normalizedSentence = normalize(sentence);
    const isRelevantEvidence =
      queryTerms.some((term) => normalizedSentence.includes(term)) &&
      containsAnyTerm(sentence, ACQUISITION_EVIDENCE_TERMS);
    if (!isRelevantEvidence) continue;
    const score = /\bhm\d+\b/u.test(normalizedSentence)
      ? HM_ACQUISITION_EVIDENCE_SCORE
      : ACQUISITION_EVIDENCE_SCORE;
    if (bestEvidence === undefined || score > bestEvidence.score) {
      bestEvidence = { score, position };
    }
  }
  return bestEvidence;
}

function scoreRecord(
  record: KnowledgeRecord,
  queryTerms: readonly string[],
  acquisitionScore: number,
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
  return relevanceScore + acquisitionScore;
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
    const queryTerms = terms(query);
    if (queryTerms.length === 0) {
      throw new Error("knowledge query must contain searchable text");
    }
    const acquisitionIntent = containsAnyTerm(query, ACQUISITION_QUERY_TERMS);
    return this.#records
      .filter(
        (record) =>
          options.domain === undefined || record.domain === options.domain,
      )
      .map((record) => {
        const evidence = acquisitionIntent
          ? acquisitionEvidence(record, queryTerms)
          : undefined;
        return {
          record,
          evidence,
          score: scoreRecord(record, queryTerms, evidence?.score ?? 0),
        };
      })
      .filter((candidate) => candidate.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.record.title.localeCompare(right.record.title),
      )
      .slice(0, options.limit)
      .map(({ record, score, evidence }) => ({
        id: record.id,
        domain: record.domain,
        title: record.title,
        excerpt: excerpt(record.body, queryTerms, evidence?.position),
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
