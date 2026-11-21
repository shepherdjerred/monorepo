import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { CatalogService } from "./catalog-filter.ts";

type ListPath = "/deployments" | "/artifacts" | "/activity";

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
 * One live line under the filters: how many rows this page shows, that none
 * match, or why a filter cannot be used. It stays mounted, so a screen reader
 * hears the new result after every filter.
 */
export function ResultSummary({
  count,
  noun,
  filtered,
  older,
  problems,
  clearTo,
}: {
  count: number;
  /** Singular and plural. */
  noun: [string, string];
  filtered: boolean;
  /** The page follows a cursor, so newer rows sit on the page before it. */
  older: boolean;
  problems: readonly string[];
  clearTo: ListPath;
}) {
  const [, plural] = noun;
  let text: string;
  let tone: string;
  if (problems.length > 0) {
    text = problems.join(" ");
    tone = "notice error";
  } else if (count === 0) {
    text = filtered ? `No ${plural} match these filters.` : `No ${plural} yet.`;
    tone = "empty";
  } else {
    text = `Showing ${String(count)} ${older ? "older " : ""}${pluralOf(
      noun,
      count,
    )}${filtered ? " that match these filters" : ""}, newest first.`;
    tone = "muted";
  }
  return (
    <div className="result-summary">
      <p role="status" className={tone}>
        {text}
      </p>
      {filtered && (count === 0 || problems.length > 0) && (
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
