import { z } from "zod";

const Optional = z
  .string()
  .trim()
  .transform((value) => (value === "" ? undefined : value))
  .optional();

/**
 * Search params come from hand-edited URLs, so a value of the wrong type is
 * dropped. A choice filter keeps whatever text was typed: the page names the
 * accepted values (`resolveChoice`) instead of silently showing everything.
 */
function lenient<T extends z.ZodType>(schema: T) {
  return z
    .unknown()
    .transform((value): z.infer<T> | undefined => schema.safeParse(value).data)
    .optional();
}

export const PipelineSearchSchema = z.object({
  q: lenient(Optional),
  status: lenient(Optional),
});
export type PipelineSearch = z.infer<typeof PipelineSearchSchema>;

export const CursorSearchSchema = z.object({ cursor: lenient(Optional) });

export const DeploymentSearchSchema = z.object({
  cursor: lenient(Optional),
  service: lenient(Optional),
  environment: lenient(Optional),
  status: lenient(Optional),
});

export const ArtifactSearchSchema = z.object({
  cursor: lenient(Optional),
  service: lenient(Optional),
  status: lenient(Optional),
});

export const ActivitySearchSchema = z.object({
  cursor: lenient(Optional),
  actor: lenient(Optional),
  action: lenient(Optional),
  entity: lenient(Optional),
  /** `only` lists just failures, refusals, lapses and alarms. */
  problems: lenient(Optional),
  /** How far back to look: the last hour or day; absent is any time. */
  within: lenient(Optional),
});

export const EnvironmentSearchSchema = z.object({
  release: lenient(z.enum(["deploy", "promote"])),
  version: lenient(Optional),
});

export const VersionSearchSchema = z.object({ compare: lenient(Optional) });

/** Keep only filter fields a form submitted with a value. */
export function formSearch(form: HTMLFormElement) {
  const values: Record<string, string> = {};
  for (const [key, value] of new FormData(form))
    if (typeof value === "string" && value.trim() !== "")
      values[key] = value.trim();
  return values;
}

function searchText(search: object, name: string) {
  const value: unknown = new Map<string, unknown>(Object.entries(search)).get(
    name,
  );
  return typeof value === "string" ? value : "";
}

/** Whether a navigation only moved between pages of the same filtered list. */
export function pagedOnly(previous: object, next: object) {
  const names = new Set([...Object.keys(previous), ...Object.keys(next)]);
  return (
    searchText(previous, "cursor") !== searchText(next, "cursor") &&
    [...names].every(
      (name) =>
        name === "cursor" ||
        searchText(previous, name) === searchText(next, name),
    )
  );
}

/**
 * Filter forms are uncontrolled, so their controls keep what was typed. After
 * a navigation that did not come from the form (Back, Forward, a link), each
 * form marked `data-search-form` shows the search the URL now carries. A
 * control that shows neither the previous URL's value nor the new one holds
 * an edit the reader has not submitted yet, and keeps it. The forms are never
 * remounted, so a submit keeps focus where it was.
 */
export function syncSearchForms(previous: object, next: object) {
  for (const form of document.querySelectorAll<HTMLFormElement>(
    "form[data-search-form]",
  ))
    for (const control of form.elements)
      if (
        (control instanceof HTMLInputElement ||
          control instanceof HTMLSelectElement) &&
        control.name !== ""
      ) {
        // A submit trims what was typed, so compare what it would send.
        const shown = control.value.trim();
        const now = searchText(next, control.name);
        if (shown === now || shown === searchText(previous, control.name))
          control.value = now;
      }
}
