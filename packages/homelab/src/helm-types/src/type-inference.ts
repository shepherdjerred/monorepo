import type {
  JSONSchemaProperty,
  TypeScriptInterface,
  TypeProperty,
} from "./types.ts";
import type { HelmValue } from "./schemas.ts";
import {
  StringSchema,
  ActualNumberSchema,
  ActualBooleanSchema,
  NullSchema,
  UndefinedSchema,
  ArraySchema,
  HelmValueSchema,
  StringBooleanSchema,
} from "./schemas.ts";
import {
  capitalizeFirst,
  sanitizePropertyName,
  sanitizeTypeName,
} from "./utils.ts";

/**
 * Convert JSON schema type to TypeScript type string
 */
export function jsonSchemaToTypeScript(schema: JSONSchemaProperty): string {
  // Handle oneOf - union of types
  if (schema.oneOf) {
    const types = schema.oneOf.map((s) => jsonSchemaToTypeScript(s));
    return types.join(" | ");
  }

  // Handle anyOf - union of types
  if (schema.anyOf) {
    const types = schema.anyOf.map((s) => jsonSchemaToTypeScript(s));
    return types.join(" | ");
  }

  // Handle enum
  if (schema.enum) {
    return schema.enum
      .map((v) =>
        StringSchema.safeParse(v).success ? `"${String(v)}"` : String(v),
      )
      .join(" | ");
  }

  // Handle array type
  if (schema.type === "array" && schema.items) {
    const itemType = jsonSchemaToTypeScript(schema.items);
    return `${itemType}[]`;
  }

  // Handle basic types
  const stringTypeCheck = StringSchema.safeParse(schema.type);
  if (stringTypeCheck.success) {
    switch (stringTypeCheck.data) {
      case "string":
        return "string";
      case "number":
      case "integer":
        return "number";
      case "boolean":
        return "boolean";
      case "object":
        return "object";
      case "array":
        return "unknown[]";
      case "null":
        return "null";
      default:
        return "unknown";
    }
  }

  // Handle multiple types
  const arrayTypeCheck = ArraySchema.safeParse(schema.type);
  if (arrayTypeCheck.success) {
    return arrayTypeCheck.data
      .map((t: unknown) => {
        if (!StringSchema.safeParse(t).success) {
          return "unknown";
        }
        const typeStr = String(t);
        switch (typeStr) {
          case "string":
            return "string";
          case "number":
          case "integer":
            return "number";
          case "boolean":
            return "boolean";
          case "object":
            return "object";
          case "array":
            return "unknown[]";
          case "null":
            return "null";
          default:
            return "unknown";
        }
      })
      .join(" | ");
  }

  return "unknown";
}

/**
 * Infer TypeScript type from actual runtime value
 */
export function inferTypeFromValue(value: unknown): string | null {
  // Check null/undefined
  if (
    NullSchema.safeParse(value).success ||
    UndefinedSchema.safeParse(value).success
  ) {
    return null;
  }

  // Check for actual boolean
  if (ActualBooleanSchema.safeParse(value).success) {
    return "boolean";
  }

  // Check for actual number
  if (ActualNumberSchema.safeParse(value).success) {
    return "number";
  }

  // Check if it's a string that looks like a boolean
  if (StringBooleanSchema.safeParse(value).success) {
    return "boolean";
  }

  // Check if it's a string that looks like a number
  const stringCheck = StringSchema.safeParse(value);
  if (stringCheck.success) {
    const trimmed = stringCheck.data.trim();
    if (
      trimmed !== "" &&
      !Number.isNaN(Number(trimmed)) &&
      Number.isFinite(Number(trimmed))
    ) {
      return "number";
    }
  }

  // Check for array
  if (ArraySchema.safeParse(value).success) {
    return "array";
  }

  // Check for object
  if (HelmValueSchema.safeParse(value).success) {
    return "object";
  }

  // Plain string
  if (StringSchema.safeParse(value).success) {
    return "string";
  }

  return "unknown";
}

/**
 * Check if inferred type is compatible with schema type
 */
export function typesAreCompatible(
  inferredType: string,
  schemaType: string,
): boolean {
  // Exact match
  if (inferredType === schemaType) {
    return true;
  }

  // Check if the inferred type is part of a union in the schema
  // For example: schemaType might be "number | \"default\"" and inferredType is "string"
  const schemaTypes = schemaType
    .split("|")
    .map((t) => t.trim().replaceAll(/^["']|["']$/g, ""));

  // If schema is a union, check if inferred type is compatible with any part
  if (schemaTypes.length > 1) {
    for (const st of schemaTypes) {
      // Handle quoted strings in unions (like "default")
      if (st.startsWith('"') && st.endsWith('"') && inferredType === "string") {
        return true;
      }
      if (st === inferredType) {
        return true;
      }
      // Arrays
      if (st.endsWith("[]") && inferredType === "array") {
        return true;
      }
    }
  }

  // Handle array types
  if (schemaType.endsWith("[]") && inferredType === "array") {
    return true;
  }

  // Handle specific string literals - if schema expects specific strings and value is a string
  if (schemaType.includes('"') && inferredType === "string") {
    return true;
  }

  // unknown is compatible with everything (schema might be less specific)
  if (schemaType === "unknown" || inferredType === "unknown") {
    return true;
  }

  return false;
}

/**
 * Convert Helm values to TypeScript interface
 */
export function convertToTypeScriptInterface(options: {
  values: HelmValue;
  interfaceName: string;
  schema?: JSONSchemaProperty | null;
  yamlComments?: Map<string, string>;
  keyPrefix?: string;
}): TypeScriptInterface {
  const keyPrefix = options.keyPrefix ?? "";
  const properties: Record<string, TypeProperty> = {};
  const schemaProps = options.schema?.properties;

  for (const [key, value] of Object.entries(options.values)) {
    const sanitizedKey = sanitizePropertyName(key);
    const typeNameSuffix = sanitizeTypeName(key);
    const propertySchema = schemaProps?.[key];
    const fullKey = keyPrefix ? `${keyPrefix}.${key}` : key;
    const yamlComment = options.yamlComments?.get(fullKey);

    properties[sanitizedKey] = convertValueToProperty({
      value,
      nestedTypeName: `${options.interfaceName}${capitalizeFirst(typeNameSuffix)}`,
      schema: propertySchema,
      propertyName: key,
      yamlComment,
      yamlComments: options.yamlComments,
      fullKey,
    });
  }

  return {
    name: options.interfaceName,
    properties,
  };
}

type InferencePropertyContext = {
  value: unknown;
  nestedTypeName: string;
  schema?: JSONSchemaProperty;
  propertyName?: string;
  yamlComment?: string;
  yamlComments?: Map<string, string>;
  fullKey?: string;
};

/**
 * Merge description from schema and YAML comments
 */
function mergeDescriptions(
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
 * Convert a value to a TypeProperty using JSON schema information
 */
function convertWithSchema(
  ctx: InferencePropertyContext & { schema: JSONSchemaProperty },
): TypeProperty {
  const {
    value,
    nestedTypeName,
    schema,
    propertyName,
    yamlComment,
    yamlComments,
    fullKey,
  } = ctx;

  const inferredType = inferTypeFromValue(value);
  const schemaType = jsonSchemaToTypeScript(schema);

  if (
    inferredType != null &&
    inferredType !== "" &&
    !typesAreCompatible(inferredType, schemaType)
  ) {
    const propName =
      propertyName != null && propertyName !== "" ? `'${propertyName}': ` : "";
    console.warn(
      `  ⚠️  Type mismatch for ${propName}Schema says '${schemaType}' but value suggests '${inferredType}' (value: ${String(value).slice(0, 50)})`,
    );
  }

  const description = mergeDescriptions(schema.description, yamlComment);
  const defaultValue = schema.default === undefined ? value : schema.default;

  // If schema defines it as an object with properties, recurse
  const helmValueCheckForProps = HelmValueSchema.safeParse(value);
  if (schema.properties && helmValueCheckForProps.success) {
    const nestedInterface = convertToTypeScriptInterface({
      values: helmValueCheckForProps.data,
      interfaceName: nestedTypeName,
      schema,
      yamlComments,
      keyPrefix: fullKey,
    });
    return {
      type: nestedTypeName,
      optional: true,
      nested: nestedInterface,
      description,
      default: defaultValue,
    };
  }

  // Handle object types without explicit properties
  const helmValueCheckForObject = HelmValueSchema.safeParse(value);
  if (schemaType === "object" && helmValueCheckForObject.success) {
    const nestedInterface = convertToTypeScriptInterface({
      values: helmValueCheckForObject.data,
      interfaceName: nestedTypeName,
      yamlComments,
      keyPrefix: fullKey,
    });
    return {
      type: nestedTypeName,
      optional: true,
      nested: nestedInterface,
      description,
      default: defaultValue,
    };
  }

  return {
    type: schemaType,
    optional: true,
    description,
    default: defaultValue,
  };
}

/**
 * Infer array element type from sampled elements
 */
function inferArrayType(
  nestedTypeName: string,
  arrayValue: unknown[],
): TypeProperty {
  if (arrayValue.length === 0) {
    return { type: "unknown[]", optional: true };
  }

  const elementTypes = new Set<string>();
  const elementTypeProps: TypeProperty[] = [];
  const sampleSize = Math.min(arrayValue.length, 3);

  for (let i = 0; i < sampleSize; i++) {
    const elementType = convertValueToProperty({
      value: arrayValue[i],
      nestedTypeName,
    });
    elementTypes.add(elementType.type);
    elementTypeProps.push(elementType);
  }

  if (elementTypes.size === 1) {
    return inferUniformArrayType(
      elementTypes,
      elementTypeProps,
      nestedTypeName,
    );
  }

  const types = [...elementTypes].toSorted();
  if (
    types.length <= 3 &&
    types.every((t) => ["string", "number", "boolean"].includes(t))
  ) {
    return { type: `(${types.join(" | ")})[]`, optional: true };
  }

  return { type: "unknown[]", optional: true };
}

/**
 * Build TypeProperty for a uniform-type array
 */
function inferUniformArrayType(
  elementTypes: Set<string>,
  elementTypeProps: TypeProperty[],
  nestedTypeName: string,
): TypeProperty {
  const elementType = [...elementTypes][0];
  const elementProp = elementTypeProps[0];
  if (elementType == null || elementType === "" || !elementProp) {
    return { type: "unknown[]", optional: true };
  }

  if (elementProp.nested) {
    const arrayElementTypeName = `${nestedTypeName}Element`;
    const arrayElementInterface: TypeScriptInterface = {
      name: arrayElementTypeName,
      properties: elementProp.nested.properties,
    };
    return {
      type: `${arrayElementTypeName}[]`,
      optional: true,
      nested: arrayElementInterface,
    };
  }

  return { type: `${elementType}[]`, optional: true };
}

/**
 * Infer a primitive TypeProperty from a runtime value (no schema)
 */
function inferPrimitiveType(
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

function convertValueToProperty(opts: InferencePropertyContext): TypeProperty {
  const { value, nestedTypeName, schema, yamlComment, yamlComments, fullKey } =
    opts;

  if (schema) {
    return convertWithSchema({ ...opts, schema });
  }

  if (
    NullSchema.safeParse(value).success ||
    UndefinedSchema.safeParse(value).success
  ) {
    return { type: "unknown", optional: true };
  }

  const arrayResult = ArraySchema.safeParse(value);
  if (arrayResult.success) {
    return inferArrayType(nestedTypeName, arrayResult.data);
  }

  const objectResult = HelmValueSchema.safeParse(value);
  if (objectResult.success) {
    const nestedInterface = convertToTypeScriptInterface({
      values: objectResult.data,
      interfaceName: nestedTypeName,
      yamlComments,
      keyPrefix: fullKey,
    });
    return {
      type: nestedTypeName,
      optional: true,
      nested: nestedInterface,
      description: yamlComment,
      default: value,
    };
  }

  return inferPrimitiveType(value, yamlComment);
}
