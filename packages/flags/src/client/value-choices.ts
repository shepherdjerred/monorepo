import { z } from "zod";
import {
  MODEL_ROUTE_KEYWORD,
  ModelRouteSchema,
  type ModelCapabilityRequirement,
  type ModelRoute,
  type VariantEncoding,
} from "@shepherdjerred/feature-flags/flag-value-spec.ts";
import generatedValueSchemas from "@shepherdjerred/feature-flags/flag-value-schemas.generated.json";
import type { ManagedVariantFlagKey } from "@shepherdjerred/feature-flags/managed-flag-keys.generated.ts";
import catalogJson from "@shepherdjerred/llm-models/catalog.json";

/*
 * The values an operator can pick for a variant flag: a closed list from the
 * key's JSON Schema `enum`/`const`, or the shared model catalog's models that
 * route the way a model-id flag's consumer resolves them (`x-model-route`).
 */

export type ModelStatus = "current" | "preview" | "deprecated";

export type ValueChoice = {
  readonly value: string;
  readonly label: string;
};

export type ModelChoice = ValueChoice & {
  readonly status: ModelStatus;
  readonly detail?: string;
};

export type ValueChoices =
  | { readonly closed: true; readonly values: readonly ValueChoice[] }
  | {
      readonly closed: false;
      readonly route: ModelRoute;
      readonly values: readonly ModelChoice[];
    };

const EndpointSchema = z.enum(["language", "embedding", "image", "decisions"]);

/**
 * The slice of `@shepherdjerred/llm-models` `catalog.json` the editor reads.
 * Non-strict: the package's own schema owns the rest of each entry.
 */
const CatalogSchema = z.record(
  z.string(),
  z.object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    description: z.string().optional(),
    status: z.enum(["current", "preview", "deprecated"]),
    pricingOnly: z.boolean().optional(),
    capabilities: z.object({
      inputModalities: z.array(z.string()),
      tools: z.boolean(),
      structuredOutputs: z.boolean(),
    }),
    routes: z.object({
      native: z
        .union([
          z.object({ endpoint: EndpointSchema }),
          z.object({ endpoints: z.array(EndpointSchema).min(1) }),
        ])
        .optional(),
      codexSdk: z.object({ modelId: z.string().min(1) }).optional(),
      claudeAgentSdk: z.object({ modelId: z.string().min(1) }).optional(),
    }),
  }),
);

type CatalogEntry = z.infer<typeof CatalogSchema>[string];

const catalog: ReadonlyMap<string, CatalogEntry> = new Map(
  Object.values(CatalogSchema.parse(catalogJson)).map((entry) => [
    entry.id,
    entry,
  ]),
);

/** `nativeRouteEndpoints` from `@shepherdjerred/llm-models`, over the parsed slice. */
function nativeEndpoints(entry: CatalogEntry): readonly string[] {
  const native = entry.routes.native;
  if (native === undefined) return [];
  return "endpoints" in native ? native.endpoints : [native.endpoint];
}

function meets(
  entry: CatalogEntry,
  requirement: ModelCapabilityRequirement,
): boolean {
  switch (requirement) {
    case "tools": {
      return entry.capabilities.tools;
    }
    case "structuredOutputs": {
      return entry.capabilities.structuredOutputs;
    }
    case "imageInput": {
      return entry.capabilities.inputModalities.includes("image");
    }
  }
}

/** Whether the flag's consumer can call `entry` the way `route` says. */
function routes(entry: CatalogEntry, route: ModelRoute): boolean {
  if (entry.pricingOnly === true) return false;
  switch (route.kind) {
    case "native": {
      return (
        nativeEndpoints(entry).includes(route.endpoint) &&
        (route.requires ?? []).every((requirement) => meets(entry, requirement))
      );
    }
    case "codexSdk": {
      return entry.routes.codexSdk !== undefined;
    }
    case "claudeAgentSdk": {
      return entry.routes.claudeAgentSdk !== undefined;
    }
  }
}

const STATUS_ORDER: Readonly<Record<ModelStatus, number>> = {
  current: 0,
  preview: 1,
  deprecated: 2,
};

/** Catalog models `route` reaches, current → preview → deprecated, then by name. */
export function modelChoices(route: ModelRoute): ModelChoice[] {
  return [...catalog.values()]
    .filter((entry) => routes(entry, route))
    .toSorted(
      (left, right) =>
        STATUS_ORDER[left.status] - STATUS_ORDER[right.status] ||
        left.displayName.localeCompare(right.displayName),
    )
    .map((entry) => ({
      value: entry.id,
      label: entry.displayName,
      status: entry.status,
      ...(entry.description === undefined ? {} : { detail: entry.description }),
    }));
}

const EnumSchema = z.array(z.unknown());

function closedValues(
  schema: Record<string, unknown>,
): readonly unknown[] | undefined {
  if ("enum" in schema) return EnumSchema.parse(schema["enum"]);
  return "const" in schema ? [schema["const"]] : undefined;
}

/**
 * A managed key's choices from its generated JSON Schema, or undefined when
 * any value its schema allows may be typed. JSON-encoded values are edited as
 * JSON, never picked.
 */
function choicesForSchema(
  encoding: VariantEncoding,
  schema: Record<string, unknown>,
): ValueChoices | undefined {
  if (encoding === "json") return undefined;
  const values = closedValues(schema);
  if (values !== undefined) {
    return {
      closed: true,
      values: values.map((value) => {
        const text = typeof value === "string" ? value : JSON.stringify(value);
        return { value: text, label: text };
      }),
    };
  }
  if (!(MODEL_ROUTE_KEYWORD in schema)) return undefined;
  const route = ModelRouteSchema.parse(schema[MODEL_ROUTE_KEYWORD]);
  return { closed: false, route, values: modelChoices(route) };
}

const GeneratedValueSchemasSchema = z.record(
  z.string(),
  z.strictObject({
    encoding: z.enum(["string", "number", "json"]),
    schema: z.record(z.string(), z.unknown()),
  }),
);

/** `flag-value-schemas.generated.json`: each managed key's decoded-value JSON Schema. */
const valueJsonSchemas = GeneratedValueSchemasSchema.parse(
  generatedValueSchemas,
);

function generatedEntry(key: ManagedVariantFlagKey) {
  const entry = valueJsonSchemas[key];
  if (entry === undefined)
    throw new Error(`flag-value-schemas.generated.json is missing ${key}`);
  return entry;
}

const choicesByKey = new Map<ManagedVariantFlagKey, ValueChoices | undefined>();
const schemasByKey = new Map<ManagedVariantFlagKey, Record<string, unknown>>();

/** A managed key's choices, derived once from its generated JSON Schema. */
export function managedChoices(
  key: ManagedVariantFlagKey,
): ValueChoices | undefined {
  if (!choicesByKey.has(key)) {
    const entry = generatedEntry(key);
    choicesByKey.set(key, choicesForSchema(entry.encoding, entry.schema));
  }
  return choicesByKey.get(key);
}

/**
 * A managed key's generated JSON Schema for Monaco, with its catalog models
 * as `examples` so JSON mode completes them (closed choices already complete
 * from `enum`/`const`). One stable object per key.
 */
export function managedValueSchema(
  key: ManagedVariantFlagKey,
): Record<string, unknown> {
  const cached = schemasByKey.get(key);
  if (cached !== undefined) return cached;
  const { schema } = generatedEntry(key);
  const choices = managedChoices(key);
  const forEditor =
    choices === undefined || choices.closed
      ? schema
      : { ...schema, examples: choices.values.map((choice) => choice.value) };
  schemasByKey.set(key, forEditor);
  return forEditor;
}

const REQUIREMENT_LABELS: Readonly<Record<ModelCapabilityRequirement, string>> =
  {
    tools: "tool calls",
    structuredOutputs: "structured outputs",
    imageInput: "image input",
  };

/** How a route reads in a sentence: "native language route with tool calls". */
function routeLabel(route: ModelRoute): string {
  switch (route.kind) {
    case "native": {
      const requires = (route.requires ?? []).map(
        (requirement) => REQUIREMENT_LABELS[requirement],
      );
      const suffix =
        requires.length === 0 ? "" : ` with ${requires.join(" and ")}`;
      return `native ${route.endpoint} route${suffix}`;
    }
    case "codexSdk": {
      return "Codex SDK route";
    }
    case "claudeAgentSdk": {
      return "Claude Agent SDK route";
    }
  }
}

/**
 * Why a model-id value is risky, or undefined when the catalog routes it the
 * way the consumer needs. Empty values are left to the registry's issues.
 */
export function modelValueNotice(
  choices: ValueChoices,
  value: string,
): string | undefined {
  if (choices.closed || value.length === 0) return undefined;
  const entry = catalog.get(value);
  if (entry === undefined) {
    return choices.route.kind === "claudeAgentSdk"
      ? "Not in the shared model catalog — it reaches the Claude Agent SDK unchecked. Add it to @shepherdjerred/llm-models first."
      : "Not in the shared model catalog — consumers reject unknown models (storm-brain fails at startup). Add it to @shepherdjerred/llm-models first.";
  }
  if (entry.pricingOnly === true) {
    return `${entry.displayName} is pricing-only in the catalog — no consumer can call it.`;
  }
  if (!routes(entry, choices.route)) {
    return `${entry.displayName} has no ${routeLabel(choices.route)} in the catalog — this flag's consumer rejects it.`;
  }
  return entry.status === "deprecated"
    ? `Deprecated in the catalog — ${entry.displayName} still routes, but pick a current model.`
    : undefined;
}
