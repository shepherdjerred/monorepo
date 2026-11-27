import { z } from "zod";
import {
  booleanPresence,
  type BooleanFlagValue,
  type FlagValue,
  type VariantFlagValue,
} from "@shepherdjerred/feature-flags/evaluate.ts";
import {
  decodeVariantValue,
  encodeVariantValue,
  flagValueEncoding,
  validateVariantValue,
} from "@shepherdjerred/feature-flags/flag-value-schemas.ts";
import {
  issuePointer,
  type VariantEncoding,
} from "@shepherdjerred/feature-flags/flag-value-spec.ts";
import type { FlagValueKeyIssue } from "@shepherdjerred/feature-flags/flag-write-validation.ts";
import {
  ManagedVariantFlagKeySchema,
  type ManagedVariantFlagKey,
} from "@shepherdjerred/feature-flags/managed-flag-keys.generated.ts";
import { BooleanFlagSchema } from "@shepherdjerred/flags/schema.ts";
import {
  managedChoices,
  managedValueSchema,
  type ValueChoices,
} from "./value-choices.ts";

const STAGE_LABELS: Readonly<Record<string, string>> = {
  beta: "Beta",
  prod: "Prod",
};

export type Route = {
  readonly catalog: string;
  readonly stage: string;
  readonly key?: string;
};

export type SidebarEntry =
  | { readonly kind: "single"; readonly id: string; readonly label: string }
  | {
      readonly kind: "group";
      readonly catalog: string;
      readonly stages: readonly {
        readonly id: string;
        readonly label: string;
      }[];
    };

/** Splits a deployment id the API returns (`catalog/stage`). */
export function splitDeploymentId(id: string): Route {
  const slash = id.indexOf("/");
  const catalog = id.slice(0, slash);
  const stage = id.slice(slash + 1);
  if (slash <= 0 || stage.length === 0 || stage.includes("/")) {
    throw new Error(`deployment id ${id} is not catalog/stage`);
  }
  return { catalog, stage };
}

export function deploymentPath(catalog: string, stage: string): string {
  return `/${encodeURIComponent(catalog)}/${encodeURIComponent(stage)}`;
}

export function flagPath(catalog: string, stage: string, key: string): string {
  return `${deploymentPath(catalog, stage)}/${encodeURIComponent(key)}`;
}

/** The browser tab title for a page, most specific part first. */
export function pageTitle(route: Route | undefined): string {
  if (route === undefined) return "Flags";
  const deployment = `${route.catalog}/${route.stage}`;
  return route.key === undefined
    ? `${deployment} · Flags`
    : `${route.key} · ${deployment} · Flags`;
}

export function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

export function sidebarEntries(ids: readonly string[]): SidebarEntry[] {
  const groups = new Map<string, { id: string; stage: string }[]>();
  for (const id of [...ids].sort()) {
    const { catalog, stage } = splitDeploymentId(id);
    const list = groups.get(catalog) ?? [];
    list.push({ id, stage });
    groups.set(catalog, list);
  }
  return [...groups.entries()].map(([catalog, stages]) => {
    const only = stages[0];
    return only !== undefined && stages.length === 1
      ? {
          kind: "single" as const,
          id: only.id,
          label: only.stage === "prod" ? catalog : only.id,
        }
      : {
          kind: "group" as const,
          catalog,
          stages: stages.map((stage) => ({
            id: stage.id,
            label: stageLabel(stage.stage),
          })),
        };
  });
}

export function listState(flag: FlagValue): string {
  if (flag.type === "variant")
    return flag.value.length === 0 ? "(empty)" : flag.value;
  const presence = booleanPresence(flag);
  return presence === "on" ? "On" : presence === "off" ? "Off" : "Targeted";
}

export function sameFlag(left: FlagValue, right: FlagValue): boolean {
  if (left.type !== right.type || left.key !== right.key) return false;
  if (left.type === "variant" && right.type === "variant")
    return left.value === right.value;
  if (left.type !== "boolean" || right.type !== "boolean") return false;
  if (
    left.default !== right.default ||
    left.rollouts.length !== right.rollouts.length
  )
    return false;
  return left.rollouts.every((rollout, index) => {
    const other = right.rollouts[index];
    if (other?.result !== rollout.result) return false;
    if (rollout.constraints.length !== other.constraints.length) return false;
    return rollout.constraints.every((constraint, constraintIndex) => {
      const theirs = other.constraints[constraintIndex];
      return (
        theirs?.property === constraint.property &&
        theirs.value === constraint.value
      );
    });
  });
}

export function draftError(flag: FlagValue): string | undefined {
  if (flag.type === "variant") return undefined;
  for (const [index, rollout] of flag.rollouts.entries()) {
    if (rollout.constraints.length === 0)
      return `Segment ${String(index + 1)} has no constraints`;
    const blank = rollout.constraints.some(
      (constraint) =>
        constraint.property.trim().length === 0 ||
        constraint.value.trim().length === 0,
    );
    if (blank) return `Segment ${String(index + 1)} has an empty constraint`;
  }
  return undefined;
}

export function flagText(flag: FlagValue): string {
  return JSON.stringify(flag, null, 2);
}

export function setBooleanDefault(
  flag: BooleanFlagValue,
  on: boolean,
): BooleanFlagValue {
  return {
    type: flag.type,
    key: flag.key,
    default: on,
    rollouts: flag.rollouts,
  };
}

export function setVariantValue(
  flag: VariantFlagValue,
  value: string,
): VariantFlagValue {
  return { type: flag.type, key: flag.key, value };
}

export function addSegment(flag: BooleanFlagValue): BooleanFlagValue {
  return {
    type: flag.type,
    key: flag.key,
    default: flag.default,
    rollouts: [
      ...flag.rollouts,
      { constraints: [{ property: "", value: "" }], result: true },
    ],
  };
}

export function removeSegment(
  flag: BooleanFlagValue,
  index: number,
): BooleanFlagValue {
  return {
    type: flag.type,
    key: flag.key,
    default: flag.default,
    rollouts: flag.rollouts.filter((_, rolloutIndex) => rolloutIndex !== index),
  };
}

export function setSegmentResult(
  flag: BooleanFlagValue,
  index: number,
  result: boolean,
): BooleanFlagValue {
  return {
    type: flag.type,
    key: flag.key,
    default: flag.default,
    rollouts: flag.rollouts.map((rollout, rolloutIndex) =>
      rolloutIndex === index
        ? { constraints: rollout.constraints, result }
        : rollout,
    ),
  };
}

export function setConstraintField(
  flag: BooleanFlagValue,
  target: {
    readonly rolloutIndex: number;
    readonly constraintIndex: number;
    readonly field: "property" | "value";
    readonly value: string;
  },
): BooleanFlagValue {
  return {
    type: flag.type,
    key: flag.key,
    default: flag.default,
    rollouts: flag.rollouts.map((rollout, index) =>
      index === target.rolloutIndex
        ? {
            constraints: rollout.constraints.map((constraint, current) => {
              if (current !== target.constraintIndex) return constraint;
              return target.field === "property"
                ? { property: target.value, value: constraint.value }
                : { property: constraint.property, value: target.value };
            }),
            result: rollout.result,
          }
        : rollout,
    ),
  };
}

export function addConstraint(
  flag: BooleanFlagValue,
  rolloutIndex: number,
): BooleanFlagValue {
  return {
    type: flag.type,
    key: flag.key,
    default: flag.default,
    rollouts: flag.rollouts.map((rollout, index) =>
      index === rolloutIndex
        ? {
            constraints: [...rollout.constraints, { property: "", value: "" }],
            result: rollout.result,
          }
        : rollout,
    ),
  };
}

export function removeConstraint(
  flag: BooleanFlagValue,
  rolloutIndex: number,
  constraintIndex: number,
): BooleanFlagValue {
  return {
    type: flag.type,
    key: flag.key,
    default: flag.default,
    rollouts: flag.rollouts.map((rollout, index) =>
      index === rolloutIndex
        ? {
            constraints: rollout.constraints.filter(
              (_, current) => current !== constraintIndex,
            ),
            result: rollout.result,
          }
        : rollout,
    ),
  };
}

/** Flags whose key contains `query`, ignoring case and surrounding spaces. */
export function filterFlags<T extends { readonly key: string }>(
  flags: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  return needle.length === 0
    ? [...flags]
    : flags.filter((flag) => flag.key.toLowerCase().includes(needle));
}

/** The `?q=` suffix that carries a search through a flag link; empty for no search. */
export function searchSuffix(query: string): string {
  const needle = query.trim();
  return needle.length === 0 ? "" : `?q=${encodeURIComponent(needle)}`;
}

/**
 * The page's search params with `q` set to the text as typed (spaces kept, so
 * the field can hold "a " on the way to "a b"), or removed when it is empty.
 */
export function withQuery(
  params: URLSearchParams,
  query: string,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (query.length === 0) next.delete("q");
  else next.set("q", query);
  return next;
}

export type FlagState = {
  readonly kind: "on" | "off" | "targeted" | "variant";
  readonly label: string;
};

/** The list state of a flag, split into the kind that picks its glyph and the word shown. */
export function flagState(flag: FlagValue): FlagState {
  if (flag.type === "variant")
    return { kind: "variant", label: listState(flag) };
  const label = listState(flag);
  const kind = label === "On" ? "on" : label === "Off" ? "off" : "targeted";
  return { kind, label };
}

// ---- Editing a flag's value: form and JSON modes over one draft ----

/** How the editor shows the draft: typed fields, or JSON text in Monaco. */
export type EditMode = "form" | "json";

/** One problem with the draft. `path` is a JSON Pointer; `""` is the whole value. */
export type EditorIssue = {
  readonly path: string;
  readonly message: string;
};

/** What the value registry knows about a flag's value. */
export type ValueKind =
  | { readonly kind: "boolean" }
  | {
      readonly kind: "managed";
      readonly key: ManagedVariantFlagKey;
      readonly encoding: VariantEncoding;
      /** Values to pick from instead of typing; see `value-choices.ts`. */
      readonly choices?: ValueChoices;
    }
  | { readonly kind: "unmanaged" };

export function valueKind(flag: FlagValue): ValueKind {
  if (flag.type === "boolean") return { kind: "boolean" };
  const key = ManagedVariantFlagKeySchema.safeParse(flag.key);
  if (!key.success) return { kind: "unmanaged" };
  const choices = managedChoices(key.data);
  return {
    kind: "managed",
    key: key.data,
    encoding: flagValueEncoding(key.data),
    ...(choices === undefined ? {} : { choices }),
  };
}

/** JSON-encoded variants open as JSON; everything else opens as a form. */
export function defaultEditMode(flag: FlagValue): EditMode {
  const kind = valueKind(flag);
  return kind.kind === "managed" && kind.encoding === "json" ? "json" : "form";
}

/** The registry's issues with a variant's stored string; empty when it decodes. */
export function valueIssues(flag: FlagValue): EditorIssue[] {
  const kind = valueKind(flag);
  if (kind.kind !== "managed" || flag.type !== "variant") return [];
  const validation = validateVariantValue(kind.key, flag.value);
  return validation.ok ? [] : [...validation.issues];
}

function parseJson(
  text: string,
): { ok: true; value: unknown } | { ok: false; message: string } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "parse failed";
    return { ok: false, message: `Invalid JSON: ${detail}` };
  }
}

/** A JSON-encoded string pretty-printed, or unchanged when it is not JSON. */
function prettyJson(raw: string): string {
  const parsed = parseJson(raw);
  return parsed.ok ? JSON.stringify(parsed.value, null, 2) : raw;
}

/**
 * The JSON text the JSON mode edits: a boolean flag's whole object, a
 * JSON-encoded variant's decoded value, a number variant's literal, or any
 * other variant's string as a JSON string literal.
 */
export function jsonText(flag: FlagValue): string {
  if (flag.type === "boolean") return flagText(flag);
  const kind = valueKind(flag);
  const encoding = kind.kind === "managed" ? kind.encoding : "string";
  if (encoding === "json") return prettyJson(flag.value);
  return encoding === "number" ? flag.value : JSON.stringify(flag.value);
}

export type JsonEdit =
  | { readonly ok: true; readonly flag: FlagValue }
  | { readonly ok: false; readonly issues: readonly EditorIssue[] };

function booleanEditSchema(key: string) {
  return BooleanFlagSchema.extend({ key: z.literal(key) });
}

function zodIssues(error: z.ZodError): EditorIssue[] {
  return error.issues.map((issue) => ({
    path: issuePointer(issue.path),
    message: issue.message,
  }));
}

function variantFromJson(
  flag: VariantFlagValue,
  kind: ValueKind,
  value: unknown,
): JsonEdit {
  if (kind.kind === "managed" && kind.encoding === "json") {
    const raw = JSON.stringify(value);
    // A valid value is stored canonically (object defaults filled in); an
    // invalid one is kept as typed so its registry issues can be shown.
    const canonical = validateVariantValue(kind.key, raw).ok
      ? encodeVariantValue(kind.key, decodeVariantValue(kind.key, raw))
      : raw;
    return { ok: true, flag: setVariantValue(flag, canonical) };
  }
  if (kind.kind === "managed" && kind.encoding === "number") {
    return typeof value === "number"
      ? { ok: true, flag: setVariantValue(flag, String(value)) }
      : {
          ok: false,
          issues: [{ path: "", message: "Expected a JSON number" }],
        };
  }
  return typeof value === "string"
    ? { ok: true, flag: setVariantValue(flag, value) }
    : { ok: false, issues: [{ path: "", message: "Expected a JSON string" }] };
}

/**
 * Reads JSON-mode text back into a draft. Text that is not JSON, a boolean
 * flag that breaks the flag schema, or a literal of the wrong type is
 * refused with its issues, and the draft keeps its last good value. A
 * variant's well-typed value always becomes the draft; `valueIssues` then
 * reports what the registry rejects.
 */
export function applyJsonText(flag: FlagValue, text: string): JsonEdit {
  const parsed = parseJson(text);
  if (!parsed.ok)
    return { ok: false, issues: [{ path: "", message: parsed.message }] };
  if (flag.type === "boolean") {
    const checked = booleanEditSchema(flag.key).safeParse(parsed.value);
    return checked.success
      ? { ok: true, flag: checked.data }
      : { ok: false, issues: zodIssues(checked.error) };
  }
  return variantFromJson(flag, valueKind(flag), parsed.value);
}

const booleanSchemas = new Map<string, Record<string, unknown>>();
const UNMANAGED_SCHEMA: Record<string, unknown> = { type: "string" };

/**
 * The JSON Schema Monaco validates JSON-mode text against: the flag object
 * with its type and key fixed (`const`) for boolean flags, the registry's
 * decoded-value schema for managed variants (catalog models as `examples`
 * for model-id keys), a plain string otherwise. Each key's schema is one
 * stable object, so the editor registers it once.
 */
export function jsonSchemaFor(flag: FlagValue): Record<string, unknown> {
  const kind = valueKind(flag);
  if (kind.kind === "boolean") {
    const cached = booleanSchemas.get(flag.key);
    if (cached !== undefined) return cached;
    const schema = z.toJSONSchema(booleanEditSchema(flag.key), {
      target: "draft-2020-12",
    });
    booleanSchemas.set(flag.key, schema);
    return schema;
  }
  return kind.kind === "unmanaged"
    ? UNMANAGED_SCHEMA
    : managedValueSchema(kind.key);
}

/** What the review and conflict diffs compare: a JSON variant's decoded value, else the flag. */
export function reviewText(flag: FlagValue): string {
  const kind = valueKind(flag);
  return flag.type === "variant" &&
    kind.kind === "managed" &&
    kind.encoding === "json"
    ? prettyJson(flag.value)
    : flagText(flag);
}

/** The server's 400 issues that belong to `key`. */
export function issuesForKey(
  issues: readonly FlagValueKeyIssue[],
  key: string,
): EditorIssue[] {
  return issues
    .filter((issue) => issue.key === key)
    .map((issue) => ({ path: issue.path, message: issue.message }));
}

/** How an issue's path reads beside its message. */
export function issuePathLabel(path: string): string {
  return path === "" ? "value" : path;
}
