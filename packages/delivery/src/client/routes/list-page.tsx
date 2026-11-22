import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { CatalogService } from "./catalog-filter.ts";
import { formSearch } from "./search-schemas.ts";

/** Pages whose filters can be cleared with a link back to the whole list. */
type FilterPath =
  "/" | "/pipelines" | "/deployments" | "/artifacts" | "/activity";

/** The ids of the shared suggestion lists the filter inputs point at. */
export const SERVICE_OPTIONS = "service-options";
export const ENVIRONMENT_OPTIONS = "environment-options";

/**
 * Suggestions for the service and environment filters, from the catalog the
 * overview shows: each id with the name people know it by.
 */
export function CatalogOptions({
  services,
  environments = false,
}: {
  services: readonly CatalogService[];
  environments?: boolean;
}) {
  return (
    <>
      <datalist id={SERVICE_OPTIONS}>
        {services.map((service) => (
          <option key={service.id} value={service.id}>
            {service.title}
          </option>
        ))}
      </datalist>
      {environments && (
        <datalist id={ENVIRONMENT_OPTIONS}>
          {services.flatMap((service) =>
            service.environments.map((environment) => (
              <option key={environment.id} value={environment.id}>
                {`${service.title} · ${environment.name}`}
              </option>
            )),
          )}
        </datalist>
      )}
    </>
  );
}

/** A filter form whose values become the page's search parameters. */
export function FilterForm({
  label,
  onSearch,
  children,
}: {
  label: string;
  onSearch: (form: HTMLFormElement) => void;
  children: ReactNode;
}) {
  return (
    <form
      className="filters"
      role="search"
      aria-label={label}
      data-search-form
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(event.currentTarget);
      }}
    >
      {children}
      <button type="submit" className="secondary-button">
        Filter
      </button>
    </form>
  );
}

function pluralOf(noun: [string, string], count: number) {
  return count === 1 ? noun[0] : noun[1];
}

/**
 * What a page of a newest-first list holds. The list has no total, so a full
 * page says it holds the newest rows and that older ones follow, never how
 * many exist; the last page is the only one that can say it shows them all.
 */
export function pageSummary({
  count,
  noun,
  filtered,
  older,
  more,
  entries,
}: {
  count: number;
  /** Singular and plural. */
  noun: [string, string];
  /**
   * How many records the rows fold, when a row can hold several, and what was
   * folded, so the count says both: "Showing 20 rows (25 events, steps
   * folded). Newest first."
   */
  entries?: FoldedRecords | undefined;
  filtered: boolean;
  /** The page follows a cursor, so newer rows sit on the page before it. */
  older: boolean;
  /** A cursor leads to older rows beyond this page. */
  more: boolean;
}) {
  const [, plural] = noun;
  const matching = filtered ? " that match these filters" : "";
  if (count === 0)
    return filtered ? `No ${plural} match these filters.` : `No ${plural} yet.`;
  if (entries !== undefined && entries.count !== count) {
    const rows = `${String(count)} ${pluralOf(noun, count)} (${String(entries.count)} ${pluralOf(entries.noun, entries.count)}, ${entries.folded})${matching}`;
    if (older) return `Showing ${rows}, older than the previous page.`;
    return more
      ? `Showing ${rows}. Newest first. Older ones are on the next page.`
      : `Showing all ${rows}. Newest first.`;
  }
  const rows = `${String(count)} ${pluralOf(noun, count)}${matching}`;
  if (older) return `Showing ${rows} older than the previous page.`;
  return more
    ? `Showing the ${String(count)} newest ${pluralOf(noun, count)}${matching}. Older ones are on the next page.`
    : `Showing all ${rows}.`;
}

/** The records a page's rows fold: how many, what to call them, and what was folded. */
export type FoldedRecords = {
  count: number;
  noun: [string, string];
  /** What the rows did to them, such as "steps folded". */
  folded: string;
};

/**
 * The message for filters that cannot be used, with the way back to the whole
 * list. It is a live region, so a screen reader hears it after a filter.
 */
export function FilterProblems({
  problems,
  clearTo,
}: {
  problems: readonly string[];
  clearTo: FilterPath;
}) {
  return (
    <div className="result-summary">
      <p role="status" className="notice error">
        {problems.join(" ")}
      </p>
      <Link to={clearTo} search={{}}>
        Clear filters
      </Link>
    </div>
  );
}

/**
 * One live line under the filters: how many rows this page shows, that none
 * match, or why a filter cannot be used. It stays mounted, so a screen reader
 * hears the new result after every filter.
 */
export function ResultSummary({
  count,
  noun,
  filtered,
  older,
  more,
  problems,
  clearTo,
  entries,
}: {
  count: number;
  noun: [string, string];
  /** The records the rows fold, when a row can hold several; see `pageSummary`. */
  entries?: FoldedRecords;
  filtered: boolean;
  older: boolean;
  more: boolean;
  problems: readonly string[];
  clearTo: FilterPath;
}) {
  if (problems.length > 0)
    return <FilterProblems problems={problems} clearTo={clearTo} />;
  return (
    <div className="result-summary">
      <p role="status" className={count === 0 ? "empty" : "muted"}>
        {pageSummary({ count, noun, filtered, older, more, entries })}
      </p>
      {filtered && count === 0 && (
        <Link to={clearTo} search={{}}>
          Clear filters
        </Link>
      )}
    </div>
  );
}

/**
 * A list page's one panel: its heading, the filters, the result line, the
 * rows and the pager. Paging moves focus to the heading, the top of the list.
 */
export function ListPanel({
  heading,
  aside,
  children,
}: {
  heading: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel list-panel" aria-labelledby="list-heading">
      <div className="section-heading">
        <h2 id="list-heading" tabIndex={-1}>
          {heading}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/**
 * Show what a submit will search for in the form itself, such as an id the
 * catalog resolved from a name, so moving through history later compares the
 * URL with what the form shows.
 */
export function showSearch(form: HTMLFormElement, values: object) {
  for (const [name, value] of Object.entries(values)) {
    const control = form.elements.namedItem(name);
    if (typeof value === "string" && control instanceof HTMLInputElement)
      control.value = value;
  }
}

/** Whether any filter other than the cursor is set. */
export function isFiltered(search: Record<string, string | undefined>) {
  return Object.entries(search).some(
    ([key, value]) => key !== "cursor" && value !== undefined,
  );
}

/**
 * The page of results a list shows. A disabled query still returns whatever
 * is cached under its key, and a filter that could not be resolved shares
 * the unfiltered list's key, so its problem is shown alone: no rows and no
 * paging from another filter.
 */
export function resolvedPage<Page>(
  data: Page | undefined,
  problems: readonly unknown[],
) {
  return problems.length === 0 ? data : undefined;
}

type Search = Record<string, string | undefined>;

/** What a filter submit searches for: the ids its names resolve to. */
export function submitted(
  form: HTMLFormElement,
  resolve: (values: Search) => { canonical: Search },
) {
  const values: Search = formSearch(form);
  for (const [name, id] of Object.entries(resolve(values).canonical))
    if (id !== undefined) values[name] = id;
  showSearch(form, values);
  return values;
}
