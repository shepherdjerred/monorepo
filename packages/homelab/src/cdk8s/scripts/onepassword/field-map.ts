import {
  formatSecretDataName,
  VAULT_ID,
  type OpItem,
} from "homelab/src/cdk8s/scripts/onepassword-lib.ts";
import type { AuditReference } from "./audit-core.ts";
import { jsonCredential } from "homelab/scripts/tofu/application-secrets.ts";

type Field = NonNullable<OpItem["fields"]>[number];
type Locator = {
  vault_id: string;
  item_id: string;
  kind: "field" | "url" | "file";
  section_id: string | null;
  field_id: string | null;
  index: number;
};
type Entry = {
  locator: Locator;
  item_title: string;
  label: string | null;
  operator_key: string;
  blank: boolean | null;
  candidate_reference: string | null;
  canonical_reference: string | null;
  status: "unique" | "ambiguous-identifier" | "metadata-only";
  consumers: AuditReference[];
  whole_item_consumers: string[];
};

export function resolveAuditItem(
  items: readonly OpItem[],
  ref: string,
  caseInsensitive = false,
): OpItem | undefined {
  const matches = (value: string) =>
    caseInsensitive ? value.toLowerCase() === ref.toLowerCase() : value === ref;
  const byId = items.filter((item) => matches(item.id));
  if (byId.length > 0) return byId.length === 1 ? byId[0] : undefined;
  const byTitle = items.filter((item) => matches(item.title));
  return byTitle.length === 1 ? byTitle[0] : undefined;
}

/** IDs are literal CLI components; spaces are supported, percent escaping is not. */
function fieldReference(item: OpItem, field: Field): string | null {
  const components = [
    VAULT_ID,
    item.id,
    ...(field.section === undefined ? [] : [field.section.id]),
    field.id,
  ];
  return components.some((part) => !/^[\w. -]+$/u.test(part))
    ? null
    : `op://${components.join("/")}`;
}

function itemEntries(item: OpItem): Entry[] {
  const base = { vault_id: VAULT_ID, item_id: item.id };
  const fields: Entry[] = (item.fields ?? []).map((field, index) => ({
    locator: {
      ...base,
      kind: "field",
      section_id: field.section?.id ?? null,
      field_id: field.id,
      index,
    },
    item_title: item.title,
    label: field.label ?? null,
    operator_key: formatSecretDataName(field.label ?? ""),
    blank: (field.value ?? "") === "",
    candidate_reference: fieldReference(item, field),
    canonical_reference: fieldReference(item, field),
    status: fieldReference(item, field) === null ? "metadata-only" : "unique",
    consumers: [],
    whole_item_consumers: [],
  }));
  const supplemental: Entry[] = [
    ...(item.urls ?? []).map((url, index) => ({
      kind: "url" as const,
      id: null,
      index,
      label: url.label ?? null,
      blank: (url.href ?? "") === "",
    })),
    ...(item.files ?? []).map((file, index) => ({
      kind: "file" as const,
      id: file.id ?? null,
      index,
      label: file.name ?? null,
      blank: null,
    })),
  ].map((entry) => ({
    locator: {
      ...base,
      kind: entry.kind,
      section_id: null,
      field_id: entry.id,
      index: entry.index,
    },
    item_title: item.title,
    label: entry.label,
    operator_key: formatSecretDataName(entry.label ?? ""),
    blank: entry.blank,
    candidate_reference: null,
    canonical_reference: null,
    status: "metadata-only",
    consumers: [],
    whole_item_consumers: [],
  }));
  return [...fields, ...supplemental];
}

function sameSelector(
  left: string | undefined,
  right: string | undefined,
  reference: AuditReference,
): boolean {
  if (left === undefined || right === undefined) return false;
  return reference.access === "onepassword"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function fieldMatches(field: Field, reference: AuditReference): boolean {
  if (reference.fieldId !== undefined && field.id !== reference.fieldId)
    return false;
  if (
    reference.sectionId !== undefined &&
    field.section?.id !== reference.sectionId
  )
    return false;
  const selector = reference.field ?? "";
  const plainMatch =
    sameSelector(selector, field.id, reference) ||
    sameSelector(selector, field.label, reference);
  const parts = selector.split("/");
  return (
    plainMatch ||
    (parts.length === 2 &&
      (sameSelector(parts[0], field.section?.id, reference) ||
        sameSelector(parts[0], field.section?.label, reference)) &&
      (sameSelector(parts[1], field.id, reference) ||
        sameSelector(parts[1], field.label, reference)))
  );
}

function matchingEntries(
  item: OpItem,
  entries: Entry[],
  reference: AuditReference,
): Entry[] {
  if (reference.access === "operator")
    return entries.filter(
      (entry) =>
        entry.operator_key !== "" &&
        entry.operator_key === reference.field &&
        entry.blank !== true,
    );
  return entries.filter((entry) => {
    if (entry.locator.kind !== "field") return false;
    const field = item.fields?.[entry.locator.index];
    return field !== undefined && fieldMatches(field, reference);
  });
}

function collisions(
  entries: Entry[],
  selector: "candidate_reference" | "operator_key",
) {
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    const value = entry[selector];
    if (value === null || value === "") continue;
    if (selector === "operator_key" && entry.blank === true) continue;
    const key =
      selector === "candidate_reference"
        ? value.toLowerCase()
        : `${entry.locator.item_id}/${value}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => {
      if (selector === "candidate_reference")
        for (const entry of group) {
          entry.canonical_reference = null;
          entry.status = "ambiguous-identifier";
        }
      return {
        kind: selector,
        selector: group[0]?.[selector] ?? "",
        locations: group.map((entry) => entry.locator),
      };
    });
}

function selectorAliases(items: readonly OpItem[], entries: Entry[]) {
  const conflicts = [];
  for (const entry of entries) {
    if (entry.status !== "unique" || entry.candidate_reference === null)
      continue;
    const item = resolveAuditItem(items, entry.locator.item_id, true);
    const selector = [entry.locator.section_id, entry.locator.field_id]
      .filter((part) => part !== null)
      .join("/");
    const matches =
      item === undefined
        ? []
        : matchingEntries(
            item,
            entries.filter(
              (candidate) => candidate.locator.item_id === item.id,
            ),
            {
              item: item.id,
              field: selector,
              access: "onepassword",
              source: "canonical-reference",
            },
          );
    if (matches.length === 1 && matches[0] === entry) continue;
    entry.canonical_reference = null;
    entry.status = "ambiguous-identifier";
    conflicts.push({
      kind: "selector_alias" as const,
      selector: entry.candidate_reference,
      locations: [
        entry,
        ...matches.filter((candidate) => candidate !== entry),
      ].map((candidate) => candidate.locator),
    });
  }
  return conflicts;
}

function referenceStatus(
  item: OpItem,
  field: Entry,
  reference: AuditReference,
): string {
  if (field.status === "ambiguous-identifier") return "ambiguous-identifier";
  if (field.blank === true) return "blank-field";
  if (reference.jsonPath !== undefined) {
    const value =
      field.locator.kind === "field"
        ? item.fields?.[field.locator.index]?.value
        : undefined;
    if (
      value === undefined ||
      jsonCredential(value, reference.jsonPath) === undefined
    )
      return "missing-json-leaf";
  }
  return "resolved";
}

function mapReference(
  items: readonly OpItem[],
  entries: Entry[],
  reference: AuditReference,
) {
  const item = resolveAuditItem(
    items,
    reference.item,
    reference.access === "onepassword",
  );
  if (item === undefined)
    return { reference, status: "missing-or-ambiguous-item", candidates: [] };
  const itemFields = entries.filter(
    (entry) => entry.locator.item_id === item.id,
  );
  if (reference.field === undefined) {
    if (reference.wholeItem === true)
      for (const entry of itemFields)
        entry.whole_item_consumers.push(reference.source);
    return {
      reference,
      status: reference.wholeItem === true ? "whole-item" : "item-binding",
      item_id: item.id,
      candidates: [],
    };
  }
  const matches = matchingEntries(item, itemFields, reference);
  const field = matches.length === 1 ? matches[0] : undefined;
  if (field === undefined)
    return {
      reference,
      status: "missing-or-ambiguous-field",
      candidates: matches.map((entry) => entry.locator),
    };
  field.consumers.push(reference);
  return {
    reference,
    status: referenceStatus(item, field, reference),
    canonical_reference: field.canonical_reference,
    locator: field.locator,
    json_path: reference.jsonPath ?? null,
    candidates: [],
  };
}

/** Every physical field is included, even templates, blank fields and configuration. */
export function buildFieldMapping(
  items: readonly OpItem[],
  references: readonly AuditReference[],
) {
  const entries = items.flatMap((item) => itemEntries(item));
  const conflicts = [
    ...collisions(entries, "candidate_reference"),
    ...collisions(entries, "operator_key"),
    ...selectorAliases(items, entries),
  ];
  const uniqueReferences = [
    ...new Map(
      references.map((reference) => [JSON.stringify(reference), reference]),
    ).values(),
  ];
  const referenceMappings = uniqueReferences.map((reference) =>
    mapReference(items, entries, reference),
  );
  for (const entry of entries)
    entry.whole_item_consumers = [
      ...new Set(entry.whole_item_consumers),
    ].toSorted();
  const fields = entries.filter((entry) => entry.locator.kind === "field");
  return {
    policy:
      "one canonical ID reference per physical field; equal values do not establish shared credential ownership",
    summary: {
      items: items.length,
      fields: fields.length,
      fields_with_unique_reference: fields.filter(
        (entry) => entry.status === "unique",
      ).length,
      ambiguous_fields: fields.filter(
        (entry) => entry.status === "ambiguous-identifier",
      ).length,
      supplemental_entries: entries.length - fields.length,
      collisions: conflicts.length,
      unresolved_references: referenceMappings.filter(
        (mapping) =>
          !["resolved", "whole-item", "item-binding"].includes(mapping.status),
      ).length,
    },
    fields,
    supplemental_entries: entries.filter(
      (entry) => entry.locator.kind !== "field",
    ),
    reference_mappings: referenceMappings,
    collisions: conflicts,
  };
}
