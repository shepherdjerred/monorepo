/** What one reconcile did, entity by entity; the route reports the counts. */
export type Result = {
  catalogRevision: string;
  services: { created: string[]; lineageChanged: string[]; retired: string[] };
  environments: {
    created: string[];
    renamed: { from: string; to: string }[];
    rebound: string[];
    retired: string[];
    /** Section 7: environments whose accepted selection moved onto catalog identities. */
    carried: string[];
  };
  recipes: { created: string[] };
  configurations: { created: string[] };
  edges: number;
  references: number;
  unchanged: number;
  refused: { id: string; reason: string }[];
};

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
