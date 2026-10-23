import type { z } from "zod";
import type { CatalogReconcileRecordSchema } from "#shared/model/route-contract.ts";

/** What one reconcile did, entity by entity: the record `catalog.reconciled` audits; the route reports the counts. */
export type Result = z.infer<typeof CatalogReconcileRecordSchema>;

/**
 * The catalog revision a reconciled row records: this reconcile's, unless the
 * reconcile refused one of the row's declared changes after `mark`. A held row
 * keeps the revision it last fully reflected, so nothing bound to the
 * reconciled catalog, an ownership handover included, accepts its held state
 * as that catalog's (C1, S3, D8).
 */
export function declaredRevision<Previous extends string | null>(
  result: Result,
  id: string,
  mark: number,
  previous: Previous,
): string | Previous {
  return result.refused.slice(mark).some((entry) => entry.id === id)
    ? previous
    : result.catalogRevision;
}

export function emptyResult(revision: string): Result {
  return {
    catalogRevision: revision,
    services: { created: [], lineageChanged: [], retired: [] },
    environments: {
      created: [],
      renamed: [],
      rebound: [],
      retired: [],
      carried: [],
    },
    recipes: { created: [] },
    configurations: { created: [] },
    edges: 0,
    references: 0,
    unchanged: 0,
    refused: [],
  };
}
