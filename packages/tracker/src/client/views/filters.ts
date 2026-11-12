import type { BootstrapData } from "#client/data/api.ts";
import { priorities } from "#client/data/issue-changes.ts";
import type { IssuePrefill } from "#client/issues/issue-form.tsx";
import { localToday } from "#client/due/dates.ts";
import { dueFilterName, isDueFilter } from "#client/due/due-filter.ts";

/**
 * The list filters and the URL parameters they have always used, so links
 * written before the filter popover keep working.
 */
export type FilterField =
  | "state"
  | "priority"
  | "assignee"
  | "creator"
  | "label"
  | "project"
  | "due"
  | "archived";

type Catalog = Pick<BootstrapData, "actors" | "projects">;

export type FilterFieldInfo = {
  field: FilterField;
  /** The name a chip and the popover use. */
  name: string;
  /** Several values at once, or one replacing the other. */
  multiple: boolean;
};

export const filterFields: readonly FilterFieldInfo[] = [
  { field: "state", name: "Status", multiple: true },
  { field: "priority", name: "Priority", multiple: false },
  { field: "assignee", name: "Assignee", multiple: false },
  { field: "creator", name: "Creator", multiple: false },
  { field: "label", name: "Label", multiple: true },
  { field: "project", name: "Project", multiple: false },
  { field: "due", name: "Due date", multiple: false },
  { field: "archived", name: "Archived", multiple: false },
];

/** `assignee=me` is written as the older `mine=true`. */
export const meValue = "me";

export function filterValues(
  params: URLSearchParams,
  field: FilterField,
): string[] {
  switch (field) {
    case "state":
    case "label": {
      return params.getAll(field);
    }
    case "assignee": {
      return params.get("mine") === "true"
        ? [meValue]
        : params.getAll("assignee").slice(0, 1);
    }
    case "archived": {
      return params.get("archived") === "true" ? ["true"] : [];
    }
    case "due": {
      return params.getAll(field).filter(isDueFilter).slice(0, 1);
    }
    case "priority":
    case "creator":
    case "project": {
      return params.getAll(field).slice(0, 1);
    }
  }
}

/** The address with one filter set to `values`; an empty list removes it. */
export function setFilter(
  params: URLSearchParams,
  field: FilterField,
  values: readonly string[],
): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete("peek");
  if (field === "assignee") {
    next.delete("mine");
    next.delete("assignee");
    const [value] = values;
    if (value === meValue) {
      next.set("mine", "true");
    } else if (value !== undefined) {
      next.set("assignee", value);
    }
    return next;
  }
  next.delete(field);
  for (const value of filterFields.find((info) => info.field === field)
    ?.multiple === true
    ? values
    : values.slice(0, 1)) {
    next.append(field, value);
  }
  return next;
}

/** Add or remove one value; a single-valued filter swaps to the new value. */
export function toggleFilterValue(
  params: URLSearchParams,
  field: FilterField,
  value: string,
): URLSearchParams {
  const current = filterValues(params, field);
  if (current.includes(value)) {
    return setFilter(
      params,
      field,
      current.filter((item) => item !== value),
    );
  }
  const multiple =
    filterFields.find((info) => info.field === field)?.multiple === true;
  return setFilter(params, field, multiple ? [...current, value] : [value]);
}

export function valueName(
  field: FilterField,
  value: string,
  catalog: Catalog,
): string {
  switch (field) {
    case "priority": {
      return priorities[Number(value)] ?? value;
    }
    case "assignee":
    case "creator": {
      return value === meValue
        ? "me"
        : (catalog.actors.find(({ key }) => key === value)?.name ?? value);
    }
    case "project": {
      return catalog.projects.find(({ slug }) => slug === value)?.name ?? value;
    }
    case "archived": {
      return "included";
    }
    case "due": {
      return dueFilterName(value, localToday());
    }
    case "state":
    case "label": {
      return value;
    }
  }
}

export type FilterChip = {
  field: FilterField;
  subject: string;
  verb: string;
  values: string;
  /** Read in full by a screen reader on the chip's remove button. */
  text: string;
};

const verbs: Record<FilterField, (count: number) => string> = {
  state: () => "is",
  priority: () => "is",
  assignee: () => "is",
  creator: () => "is",
  project: () => "is",
  label: (count) => (count > 1 ? "have" : "has"),
  archived: () => "",
  due: () => "",
};

/** The filters in effect, as the chips under the view header show them. */
export function filterChips(
  params: URLSearchParams,
  catalog: Catalog,
): FilterChip[] {
  return filterFields.flatMap(({ field, name }) => {
    const values = filterValues(params, field);
    if (values.length === 0) {
      return [];
    }
    // A due filter reads as one phrase: "Overdue", "Due by Nov 20".
    if (field === "due") {
      const phrase = valueName(field, values[0] ?? "", catalog);
      const chip: FilterChip = {
        field,
        subject: phrase,
        verb: "",
        values: "",
        text: phrase,
      };
      return [chip];
    }
    const subject =
      field === "label" && values.length > 1
        ? "Labels"
        : field === "archived"
          ? "Archived issues"
          : name;
    const verb = verbs[field](values.length);
    const joined = values
      .map((value) => valueName(field, value, catalog))
      .join(field === "label" ? " and " : ", ");
    return [
      {
        field,
        subject,
        verb,
        values: joined,
        text: [subject, verb, joined].filter((part) => part !== "").join(" "),
      },
    ];
  });
}

/**
 * What an issue created from this view starts with, so it lands in the view:
 * its team and project, a single filtered status or priority, the filtered
 * labels and assignee.
 */
export function viewPrefill(
  params: URLSearchParams,
  scope: { teamKey: string; projectSlug: string | undefined; me: string },
): IssuePrefill {
  const states = filterValues(params, "state");
  const [priority] = filterValues(params, "priority");
  const [assignee] = filterValues(params, "assignee");
  const project = scope.projectSlug ?? filterValues(params, "project")[0];
  const labels = filterValues(params, "label");
  return {
    teamKey: scope.teamKey,
    ...(states.length === 1 && states[0] !== undefined
      ? { stateName: states[0] }
      : {}),
    ...(priority === undefined ? {} : { priority: Number(priority) }),
    ...(project === undefined ? {} : { projectSlug: project }),
    ...(labels.length === 0 ? {} : { labels }),
    ...(assignee === undefined
      ? {}
      : { assigneeKey: assignee === meValue ? scope.me : assignee }),
  };
}
