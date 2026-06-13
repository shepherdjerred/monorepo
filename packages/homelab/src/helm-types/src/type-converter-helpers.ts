import type { JSONSchemaProperty, TypeProperty } from "./types.ts";
import {
  StringSchema,
  ActualNumberSchema,
  ActualBooleanSchema,
  StringBooleanSchema,
} from "./schemas.ts";

export type PropertyConversionContext = {
  value: unknown;
  nestedTypeName: string;
  schema?: JSONSchemaProperty;
  propertyName?: string;
  yamlComment?: string;
  yamlComments?: Map<string, string>;
  fullKey?: string;
  chartName?: string;
};

/**
 * Merge description from schema and YAML comments
 */
export function mergeDescriptions(
  schemaDescription: string | undefined,
  yamlComment: string | undefined,
): string | undefined {
  if (yamlComment == null || yamlComment === "") {
    return schemaDescription;
  }
  return schemaDescription != null && schemaDescription !== ""
    ? `${yamlComment}\n\n${schemaDescription}`
    : yamlComment;
}

/**
 * Infer a primitive TypeProperty from a runtime value (no schema)
 */
export function inferPrimitiveType(
  value: unknown,
  yamlComment?: string,
): TypeProperty {
  if (ActualBooleanSchema.safeParse(value).success) {
    return {
      type: "boolean",
      optional: true,
      description: yamlComment,
      default: value,
    };
  }

  if (ActualNumberSchema.safeParse(value).success) {
    return {
      type: "number",
      optional: true,
      description: yamlComment,
      default: value,
    };
  }

  if (StringBooleanSchema.safeParse(value).success) {
    return {
      type: "boolean",
      optional: true,
      description: yamlComment,
      default: value,
    };
  }

  const stringCheckForNumber = StringSchema.safeParse(value);
  if (stringCheckForNumber.success) {
    const trimmed = stringCheckForNumber.data.trim();
    if (
      trimmed !== "" &&
      !Number.isNaN(Number(trimmed)) &&
      Number.isFinite(Number(trimmed))
    ) {
      return {
        type: "number",
        optional: true,
        description: yamlComment,
        default: value,
      };
    }
  }

  const stringCheckForPlain = StringSchema.safeParse(value);
  if (stringCheckForPlain.success) {
    if (stringCheckForPlain.data === "default") {
      return {
        type: "string | number | boolean",
        optional: true,
        description: yamlComment,
        default: value,
      };
    }
    return {
      type: "string",
      optional: true,
      description: yamlComment,
      default: value,
    };
  }

  console.warn(
    `Unrecognized value type for: ${String(value)}, using 'unknown'`,
  );
  return { type: "unknown", optional: true, description: yamlComment };
}
