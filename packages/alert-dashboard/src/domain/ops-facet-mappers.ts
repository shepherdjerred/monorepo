import {
  FACET_KEYS,
  FACET_SCHEMAS,
  OpsFacetsSchema,
  type FacetByKey,
  type FacetKey,
  type OpsFacets,
} from "@shepherdjerred/ops-model/facets.ts";
import { z } from "zod";
import { ChangeViewSchema, type ChangeView } from "#shared/ops-schema";
import { epochNanosecondsToInstantText } from "#shared/time";

export const SeenSignalIdsSchema = z.array(z.string());
export const DigestStatusSchema = z.enum([
  "sending",
  "sent",
  "failed",
  "skipped",
]);
export const INCIDENT_SEVERITIES = ["critical", "warning"];

const FACET_SCHEMA_BY_KEY: {
  readonly [K in FacetKey]: z.ZodType<FacetByKey[K]>;
} = FACET_SCHEMAS;

export type CachedFacet = {
  generatedAtNs: bigint;
  receivedAtNs: bigint;
  data: unknown;
};

export type ChangeRow = {
  id: string;
  source: string;
  externalId: string;
  service: string | null;
  kind: string;
  title: string;
  occurredAtNs: bigint;
  severity: string;
  url: string | null;
};

export type ChangeFields = Pick<
  ChangeRow,
  "kind" | "service" | "title" | "occurredAtNs" | "severity" | "url"
>;

export function sameChangeFields(
  stored: ChangeFields,
  next: ChangeFields,
): boolean {
  return (
    stored.kind === next.kind &&
    stored.service === next.service &&
    stored.title === next.title &&
    stored.occurredAtNs === next.occurredAtNs &&
    stored.severity === next.severity &&
    stored.url === next.url
  );
}

export function parseFacetPayload<K extends FacetKey>(
  key: K,
  payload: unknown,
): FacetByKey[K] {
  return FACET_SCHEMA_BY_KEY[key].parse(payload);
}

export function extractFacetEntries(
  facets: OpsFacets | undefined,
): (readonly [FacetKey, unknown])[] {
  if (facets === undefined) {
    return [];
  }
  return FACET_KEYS.flatMap((key) => {
    const value = facets[key];
    return value === undefined ? [] : [[key, value] as const];
  });
}

export function buildAllFacetsView(cache: ReadonlyMap<FacetKey, CachedFacet>): {
  facets: OpsFacets;
  receivedAtNs: bigint | null;
  generatedAtNs: bigint | null;
} {
  const entries: Record<string, unknown> = {};
  let receivedAtNs: bigint | null = null;
  let generatedAtNs: bigint | null = null;
  for (const [key, cached] of cache) {
    entries[key] = cached.data;
    if (receivedAtNs === null || cached.receivedAtNs > receivedAtNs) {
      receivedAtNs = cached.receivedAtNs;
    }
    if (generatedAtNs === null || cached.generatedAtNs > generatedAtNs) {
      generatedAtNs = cached.generatedAtNs;
    }
  }
  return {
    facets: OpsFacetsSchema.parse(entries),
    receivedAtNs,
    generatedAtNs,
  };
}

export function toChangeView(row: ChangeRow): ChangeView {
  return ChangeViewSchema.parse({
    id: row.id,
    source: row.source,
    externalId: row.externalId,
    kind: row.kind,
    ...(row.service === null ? {} : { service: row.service }),
    title: row.title,
    occurredAt: epochNanosecondsToInstantText(row.occurredAtNs),
    severity: row.severity,
    ...(row.url === null ? {} : { url: row.url }),
  });
}

export function nsRange(
  sinceNs: bigint | undefined,
  untilNs: bigint | undefined,
): { gte?: bigint; lt?: bigint } {
  return {
    ...(sinceNs === undefined ? {} : { gte: sinceNs }),
    ...(untilNs === undefined ? {} : { lt: untilNs }),
  };
}
