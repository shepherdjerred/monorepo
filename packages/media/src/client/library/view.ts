/**
 * What the All segment shows, as its address says it. Search, filters, sort
 * and layout live in the query string, so a view can be linked, bookmarked,
 * and reloaded, and Back undoes a filter.
 *
 * The address is something a person can type, so a value this page does not
 * know reads as that setting's default instead of failing the page.
 */

export const KINDS = ["all", "movie", "series"] as const;
export const KEEPING = ["all", "keep", "temporary", "unclassified"] as const;
export const STATUSES = ["all", "available", "unavailable"] as const;
export const SORTS = ["title", "added"] as const;
const LAYOUTS = ["grid", "list"] as const;

export type LibraryView = {
  query: string;
  kind: (typeof KINDS)[number];
  keeping: (typeof KEEPING)[number];
  status: (typeof STATUSES)[number];
  sort: (typeof SORTS)[number];
  layout: (typeof LAYOUTS)[number];
};

export const DEFAULT_VIEW: LibraryView = {
  query: "",
  kind: "all",
  keeping: "all",
  status: "all",
  sort: "title",
  layout: "grid",
};

/** The library API accepts at most 200 characters of search text. */
export const QUERY_LIMIT = 200;
/** Divides evenly into every column count the grid uses up to eight. */
const PAGE_SIZE = 48;

function oneOf<Value extends string>(
  allowed: readonly Value[],
  value: string | null,
  fallback: Value,
): Value {
  return allowed.find((candidate) => candidate === value) ?? fallback;
}

export function readLibraryView(params: URLSearchParams): LibraryView {
  return {
    query: (params.get("q") ?? "").slice(0, QUERY_LIMIT),
    kind: oneOf(KINDS, params.get("kind"), DEFAULT_VIEW.kind),
    keeping: oneOf(KEEPING, params.get("keeping"), DEFAULT_VIEW.keeping),
    status: oneOf(STATUSES, params.get("status"), DEFAULT_VIEW.status),
    sort: oneOf(SORTS, params.get("sort"), DEFAULT_VIEW.sort),
    layout: oneOf(LAYOUTS, params.get("view"), DEFAULT_VIEW.layout),
  };
}

/** The query string of a view, naming only what differs from the default. */
export function libraryViewSearch(view: LibraryView): string {
  const params = new URLSearchParams();
  if (view.query !== "") params.set("q", view.query);
  if (view.kind !== DEFAULT_VIEW.kind) params.set("kind", view.kind);
  if (view.keeping !== DEFAULT_VIEW.keeping)
    params.set("keeping", view.keeping);
  if (view.status !== DEFAULT_VIEW.status) params.set("status", view.status);
  if (view.sort !== DEFAULT_VIEW.sort) params.set("sort", view.sort);
  if (view.layout !== DEFAULT_VIEW.layout) params.set("view", view.layout);
  const search = params.toString();
  return search === "" ? "" : `?${search}`;
}

/** Whether the view narrows the library; the layout and sort do not. */
export function isFiltered(view: LibraryView): boolean {
  return (
    view.query.trim() !== "" ||
    view.kind !== DEFAULT_VIEW.kind ||
    view.keeping !== DEFAULT_VIEW.keeping ||
    view.status !== DEFAULT_VIEW.status
  );
}

/** The `GET /api/v1/library` read for one page of a view. */
export function libraryReadPath(
  view: LibraryView,
  cursor: string | null,
): string {
  const params = new URLSearchParams({
    query: view.query,
    kind: view.kind,
    policy: view.keeping,
    availability: view.status,
    sort: view.sort,
    limit: String(PAGE_SIZE),
  });
  if (cursor !== null) params.set("cursor", cursor);
  return `/library?${params.toString()}`;
}
