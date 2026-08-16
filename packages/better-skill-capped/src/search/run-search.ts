import { count, search } from "@orama/orama";
import type { Results, SearchParamsFullText } from "@orama/orama";
import type { Kind } from "#src/model/content";
import type { Role } from "#src/model/role";
import type { SearchIndex } from "./index-builder.ts";
import type { SearchDoc } from "./search-doc.ts";

export type SortOption =
  | "relevance"
  | "newest"
  | "oldest"
  | "shortest"
  | "longest";

export type SearchRunParams = {
  q: string;
  kind: Kind[];
  role: Role[];
  champion: string[];
  staff: string[];
  tag: string[];
  carry: string[];
  ctype: string[];
  watched: "any" | "watched" | "unwatched";
  bookmarked: "any" | "bookmarked" | "unbookmarked";
  sort: SortOption;
  page: number;
};

export type UserContentState = {
  watchedUuids: ReadonlySet<string>;
  bookmarkedUuids: ReadonlySet<string>;
};

export type FacetCounts = Record<string, number>;

export type SearchRunResult = {
  /** The requested page of matching docs. */
  docs: SearchDoc[];
  /** Total matches after all filtering. */
  total: number;
  pageCount: number;
  /** The page actually served, after clamping into [1, pageCount]. */
  page: number;
  /** Conjunctive facet counts, corrected for the post-filter pass. */
  facets: {
    kind: FacetCounts;
    role: FacetCounts;
    champion: FacetCounts;
    staff: FacetCounts;
    tags: FacetCounts;
    carry: FacetCounts;
    commentaryType: FacetCounts;
  };
};

export const SEARCH_PAGE_SIZE = 20;

const SEARCHED_PROPERTIES = [
  "title",
  "champions",
  "searchAux",
  "childTitles",
  "staffText",
  "description",
] as const;

const BOOSTS = {
  title: 4,
  champions: 3,
  searchAux: 3,
  childTitles: 2,
  staffText: 2,
  description: 1,
};

// Orama caps facet values at 10 by default; every real cardinality here is
// known (173 champions, ~25 coaches, ~100 tags).
const FACETS_CONFIG = {
  kind: { limit: 3 },
  role: { limit: 6 },
  yourChampion: { limit: 200 },
  staff: { limit: 50 },
  tags: { limit: 150 },
  carry: { limit: 3 },
  commentaryType: { limit: 5 },
};

type EnumInClause = { in: string[] };

function buildWhere(
  params: SearchRunParams,
): Record<string, EnumInClause> | undefined {
  const where: Record<string, EnumInClause> = {};
  if (params.kind.length > 0) {
    where["kind"] = { in: params.kind };
  }
  if (params.role.length > 0) {
    where["role"] = { in: params.role };
  }
  if (params.champion.length > 0) {
    where["yourChampion"] = { in: params.champion };
  }
  if (params.staff.length > 0) {
    where["staff"] = { in: params.staff };
  }
  if (params.carry.length > 0) {
    where["carry"] = { in: params.carry };
  }
  if (params.ctype.length > 0) {
    where["commentaryType"] = { in: params.ctype };
  }
  return Object.keys(where).length > 0 ? where : undefined;
}

function passesUserState(
  doc: SearchDoc,
  params: SearchRunParams,
  state: UserContentState,
): boolean {
  if (params.watched === "watched" && !state.watchedUuids.has(doc.uuid)) {
    return false;
  }
  if (params.watched === "unwatched" && state.watchedUuids.has(doc.uuid)) {
    return false;
  }
  if (
    params.bookmarked === "bookmarked" &&
    !state.bookmarkedUuids.has(doc.uuid)
  ) {
    return false;
  }
  if (
    params.bookmarked === "unbookmarked" &&
    state.bookmarkedUuids.has(doc.uuid)
  ) {
    return false;
  }
  // Multi-select tags are OR within the group.
  if (
    params.tag.length > 0 &&
    !params.tag.some((tag) => doc.tags.includes(tag))
  ) {
    return false;
  }
  return true;
}

function extractFacets(results: Results<SearchDoc>): SearchRunResult["facets"] {
  const read = (field: keyof typeof FACETS_CONFIG): FacetCounts => {
    const facet = results.facets?.[field];
    return facet === undefined ? {} : { ...facet.values };
  };
  return {
    kind: read("kind"),
    role: read("role"),
    champion: read("yourChampion"),
    staff: read("staff"),
    tags: read("tags"),
    carry: read("carry"),
    commentaryType: read("commentaryType"),
  };
}

function decrement(counts: FacetCounts, value: string): void {
  const current = counts[value];
  if (current !== undefined) {
    counts[value] = current - 1;
  }
}

function decrementFacetsFor(
  facets: SearchRunResult["facets"],
  doc: SearchDoc,
): void {
  decrement(facets.kind, doc.kind);
  decrement(facets.role, doc.role);
  if (doc.yourChampion !== "") {
    decrement(facets.champion, doc.yourChampion);
  }
  if (doc.staff !== "") {
    decrement(facets.staff, doc.staff);
  }
  for (const tag of doc.tags) {
    decrement(facets.tags, tag);
  }
  if (doc.carry !== "") {
    decrement(facets.carry, doc.carry);
  }
  if (doc.commentaryType !== "") {
    decrement(facets.commentaryType, doc.commentaryType);
  }
}

function sortDocs(docs: SearchDoc[], sort: SortOption): SearchDoc[] {
  switch (sort) {
    case "relevance": {
      // Relevance is the engine's hit order; with no query it degrades to
      // the already-applied recency order.
      return docs;
    }
    case "newest": {
      return [...docs].sort((a, b) => b.releaseDate - a.releaseDate);
    }
    case "oldest": {
      return [...docs].sort((a, b) => a.releaseDate - b.releaseDate);
    }
    case "shortest": {
      return [...docs].sort(
        (a, b) => a.durationInSeconds - b.durationInSeconds,
      );
    }
    case "longest": {
      return [...docs].sort(
        (a, b) => b.durationInSeconds - a.durationInSeconds,
      );
    }
  }
}

/**
 * One pure search pass: Orama query (facets + enum where-clauses), then a
 * linear post-filter for user-local state (watched/bookmarked live in
 * localStorage and mutate constantly — pushing them into the index would
 * mean remove/insert churn per toggle), then facet-count correction for the
 * removed docs, then sort and pagination.
 */
export async function runSearch(
  index: SearchIndex,
  params: SearchRunParams,
  state: UserContentState,
): Promise<SearchRunResult> {
  const limit = count(index);
  const term = params.q.trim();
  const where = buildWhere(params);

  const baseParams: SearchParamsFullText<SearchIndex, SearchDoc> = {
    limit,
    facets: FACETS_CONFIG,
  };
  if (where !== undefined) {
    baseParams.where = where;
  }
  if (term === "") {
    baseParams.sortBy = { property: "releaseDate", order: "DESC" };
  } else {
    baseParams.term = term;
    baseParams.properties = [...SEARCHED_PROPERTIES];
    baseParams.boost = BOOSTS;
    baseParams.tolerance = 1;
    baseParams.threshold = 0;
  }

  let results = await search<SearchIndex, SearchDoc>(index, baseParams);
  if (term !== "" && results.hits.length === 0) {
    // AND semantics came up empty; degrade gracefully to OR for typo-heavy
    // multi-word queries instead of returning nothing.
    results = await search<SearchIndex, SearchDoc>(index, {
      ...baseParams,
      threshold: 1,
    });
  }

  const facets = extractFacets(results);
  const kept: SearchDoc[] = [];
  for (const hit of results.hits) {
    if (passesUserState(hit.document, params, state)) {
      kept.push(hit.document);
    } else {
      decrementFacetsFor(facets, hit.document);
    }
  }

  const sorted = sortDocs(kept, params.sort);
  const pageCount = Math.ceil(sorted.length / SEARCH_PAGE_SIZE);
  // Clamp URL-supplied pages into range: a stale or hand-edited page must
  // never render an empty slice while results exist.
  const page = Math.min(Math.max(params.page, 1), Math.max(pageCount, 1));
  const start = (page - 1) * SEARCH_PAGE_SIZE;

  return {
    docs: sorted.slice(start, start + SEARCH_PAGE_SIZE),
    total: sorted.length,
    pageCount,
    page,
    facets,
  };
}
