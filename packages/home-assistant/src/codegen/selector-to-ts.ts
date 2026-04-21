import { z } from "zod";
import type { HaFieldType } from "#schema/types.ts";
import type {
  ServiceFieldSelector,
  ServiceFieldSpec,
  ServiceTargetSpec,
} from "./introspect.ts";

/**
 * Translate an HA field spec (selector + metadata) into the structural shape
 * the runtime HaServiceFieldMeta records carry at compile time.
 */
export type FieldMeta = {
  type: HaFieldType;
  required: boolean;
  domain?: string;
  options?: string[];
};

const SelectOptionStringSchema = z.string();
const SelectOptionObjectSchema = z.object({ value: z.string() }).loose();

const EntityDescriptorSchema = z
  .object({
    domain: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .loose();
const EntityFieldSchema = z
  .object({
    entity: z.union([EntityDescriptorSchema, z.array(EntityDescriptorSchema)]),
  })
  .loose();

export function fieldMetaFromSpec(spec: ServiceFieldSpec): FieldMeta {
  const required = spec.required === true;
  const selector = spec.selector;
  if (selector === undefined) {
    return { type: inferFromExample(spec), required };
  }
  if (selector.number !== undefined) {
    return { type: "number", required };
  }
  if (selector.boolean !== undefined) {
    return { type: "boolean", required };
  }
  if (selector.text !== undefined || selector.template !== undefined) {
    return { type: "string", required };
  }
  if (selector.select !== undefined) {
    const options = extractSelectOptions(selector);
    return {
      type: "string",
      required,
      ...(options !== undefined && { options }),
    };
  }
  if (selector.object !== undefined) {
    return { type: "object", required };
  }
  if (selector.entity !== undefined) {
    const domain = extractEntityDomain(selector);
    return {
      type: "entity",
      required,
      ...(domain !== undefined && { domain }),
    };
  }
  return { type: "unknown", required };
}

export function targetDomainFromSpec(
  target: ServiceTargetSpec | undefined,
): string | undefined {
  if (target === undefined) {
    return undefined;
  }
  return extractEntityDomain(target);
}

function extractSelectOptions(
  selector: ServiceFieldSelector,
): string[] | undefined {
  const select = selector.select;
  if (select?.options === undefined) {
    return undefined;
  }
  const out: string[] = [];
  for (const opt of select.options) {
    const asString = SelectOptionStringSchema.safeParse(opt);
    if (asString.success) {
      out.push(asString.data);
      continue;
    }
    const asObject = SelectOptionObjectSchema.safeParse(opt);
    if (asObject.success) {
      out.push(asObject.data.value);
    }
  }
  return out.length > 0 ? out : undefined;
}

function extractEntityDomain(
  obj: ServiceFieldSelector | ServiceTargetSpec,
): string | undefined {
  const parsed = EntityFieldSchema.safeParse(obj);
  if (!parsed.success) {
    return undefined;
  }
  const entity = parsed.data.entity;
  const descriptor = Array.isArray(entity) ? entity[0] : entity;
  if (descriptor === undefined) {
    return undefined;
  }
  const domain = descriptor.domain;
  if (typeof domain === "string") {
    return domain;
  }
  if (Array.isArray(domain) && typeof domain[0] === "string") {
    return domain[0];
  }
  return undefined;
}

function inferFromExample(spec: ServiceFieldSpec): HaFieldType {
  const example = spec.example;
  if (typeof example === "number") {
    return "number";
  }
  if (typeof example === "boolean") {
    return "boolean";
  }
  if (typeof example === "string") {
    return "string";
  }
  if (example !== null && typeof example === "object") {
    return "object";
  }
  return "unknown";
}
