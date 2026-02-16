import type { JSONSchemaProperty, TypeScriptInterface, TypeProperty } from "./types.js";
import type { HelmValue } from "./schemas.js";
import {
  StringSchema,
  ActualNumberSchema,
  ActualBooleanSchema,
  NullSchema,
  UndefinedSchema,
  ArraySchema,
  HelmValueSchema,
  StringBooleanSchema,
} from "./schemas.js";
import { capitalizeFirst, sanitizePropertyName, sanitizeTypeName } from "./utils.js";

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
    return schema.enum.map((v) => (StringSchema.safeParse(v).success ? `"${String(v)}"` : String(v))).join(" | ");
  }

  // Handle array type
  if (schema.type === "array" && schema.items) {
    const itemType = jsonSchemaToTypeScript(schema.items);
    return `${itemType}[]`;
  }

  // Handle basic types
  if (StringSchema.safeParse(schema.type).success) {
    switch (schema.type) {
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
        if (!StringSchema.safeParse(t).success) return "unknown";
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
  if (NullSchema.safeParse(value).success || UndefinedSchema.safeParse(value).success) {
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
    if (trimmed !== "" && !isNaN(Number(trimmed)) && isFinite(Number(trimmed))) {
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
export function typesAreCompatible(inferredType: string, schemaType: string): boolean {
  // Exact match
  if (inferredType === schemaType) {
    return true;
  }

  // Check if the inferred type is part of a union in the schema
  // For example: schemaType might be "number | \"default\"" and inferredType is "string"
  const schemaTypes = schemaType.split("|").map((t) => t.trim().replace(/^["']|["']$/g, ""));

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
export function convertToTypeScriptInterface(
  values: HelmValue,
  interfaceName: string,
  schema?: JSONSchemaProperty | null,
  yamlComments?: Map<string, string>,
  keyPrefix = "",
): TypeScriptInterface {
  const properties: Record<string, TypeProperty> = {};
  const schemaProps = schema?.properties;

  for (const [key, value] of Object.entries(values)) {
    const sanitizedKey = sanitizePropertyName(key);
    const typeNameSuffix = sanitizeTypeName(key);
    const propertySchema = schemaProps?.[key];
    const fullKey = keyPrefix ? `${keyPrefix}.${key}` : key;
    const yamlComment = yamlComments?.get(fullKey);

    properties[sanitizedKey] = convertValueToProperty(
      value,
      `${interfaceName}${capitalizeFirst(typeNameSuffix)}`,
      propertySchema,
      key, // Pass the property name for better warnings
      yamlComment,
      yamlComments,
      fullKey,
    );
  }

  return {
    name: interfaceName,
    properties,
  };
}

function convertValueToProperty(
  value: unknown,
  nestedTypeName: string,
  schema?: JSONSchemaProperty,
  propertyName?: string,
  yamlComment?: string,
  yamlComments?: Map<string, string>,
  fullKey?: string,
): TypeProperty {
  // If we have a JSON schema for this property, prefer it over inference
  if (schema) {
    // First, infer the type from the actual value for comparison
    const inferredType = inferTypeFromValue(value);
    const schemaType = jsonSchemaToTypeScript(schema);

    // Check if schema and inferred types are in agreement
    if (inferredType && !typesAreCompatible(inferredType, schemaType)) {
      const propName = propertyName ? `'${propertyName}': ` : "";
      console.warn(
        `  ⚠️  Type mismatch for ${propName}Schema says '${schemaType}' but value suggests '${inferredType}' (value: ${String(value).substring(0, 50)})`,
      );
    }

    // Merge description from schema and YAML comments
    let description = schema.description;
    if (yamlComment) {
      if (description) {
        // If both exist, combine them
        description = `${yamlComment}\n\n${description}`;
      } else {
        description = yamlComment;
      }
    }
    const defaultValue = schema.default !== undefined ? schema.default : value;

    // If schema defines it as an object with properties, recurse
    const helmValueCheckForProps = HelmValueSchema.safeParse(value);
    if (schema.properties && helmValueCheckForProps.success) {
      const nestedInterface = convertToTypeScriptInterface(
        helmValueCheckForProps.data,
        nestedTypeName,
        schema,
        yamlComments,
        fullKey,
      );
      return {
        type: nestedTypeName,
        optional: true,
        nested: nestedInterface,
        description,
        default: defaultValue,
      };
    }

    // Otherwise, use the schema type directly
    const tsType = schemaType;

    // Handle object types without explicit properties
    const helmValueCheckForObject = HelmValueSchema.safeParse(value);
    if (tsType === "object" && helmValueCheckForObject.success) {
      const nestedInterface = convertToTypeScriptInterface(
        helmValueCheckForObject.data,
        nestedTypeName,
        undefined,
        yamlComments,
        fullKey,
      );
      return {
        type: nestedTypeName,
        optional: true,
        nested: nestedInterface,
        description,
        default: defaultValue,
      };
    }

    return { type: tsType, optional: true, description, default: defaultValue };
  }

  // Fall back to runtime type inference when no schema is available
  // Use Zod schemas for robust type detection
  // IMPORTANT: Check for complex types (arrays, objects) BEFORE primitive types with coercion

  // Check for null/undefined first
  if (NullSchema.safeParse(value).success || UndefinedSchema.safeParse(value).success) {
    return { type: "unknown", optional: true };
  }

  // Check for array (before coercion checks, as coercion can convert arrays to true)
  const arrayResult = ArraySchema.safeParse(value);
  if (arrayResult.success) {
    const arrayValue = arrayResult.data;
    if (arrayValue.length === 0) {
      return { type: "unknown[]", optional: true };
    }

    // Sample multiple elements for better type inference
    const elementTypes = new Set<string>();
    const elementTypeProps: TypeProperty[] = [];
    const sampleSize = Math.min(arrayValue.length, 3); // Check up to 3 elements

    for (let i = 0; i < sampleSize; i++) {
      const elementType = convertValueToProperty(arrayValue[i], nestedTypeName);
      elementTypes.add(elementType.type);
      elementTypeProps.push(elementType);
    }

    // If all elements have the same type, use that
    if (elementTypes.size === 1) {
      const elementType = Array.from(elementTypes)[0];
      const elementProp = elementTypeProps[0];
      if (elementType && elementProp) {
        // For object array elements, we need to create a proper interface for the array element
        if (elementProp.nested) {
          // Create a new interface name for array elements
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
        } else {
          return {
            type: `${elementType}[]`,
            optional: true,
          };
        }
      }
    }

    // If mixed types, use union type for common cases
    const types = Array.from(elementTypes).sort();
    if (types.length <= 3 && types.every((t) => ["string", "number", "boolean"].includes(t))) {
      return {
        type: `(${types.join(" | ")})[]`,
        optional: true,
      };
    }

    // Otherwise fall back to unknown[]
    return { type: "unknown[]", optional: true };
  }

  // Check for object (before primitive coercion checks)
  const objectResult = HelmValueSchema.safeParse(value);
  if (objectResult.success) {
    const nestedInterface = convertToTypeScriptInterface(
      objectResult.data,
      nestedTypeName,
      undefined,
      yamlComments,
      fullKey,
    );
    return {
      type: nestedTypeName,
      optional: true,
      nested: nestedInterface,
      description: yamlComment,
      default: value,
    };
  }

  // Now check for primitives - first actual runtime types, then coerced string types
  // This prevents objects from being coerced to booleans

  // Check for actual runtime boolean (true/false)
  if (ActualBooleanSchema.safeParse(value).success) {
    return { type: "boolean", optional: true, description: yamlComment, default: value };
  }

  // Check for actual runtime number
  if (ActualNumberSchema.safeParse(value).success) {
    return { type: "number", optional: true, description: yamlComment, default: value };
  }

  // Check if it's a string that represents a boolean ("true", "FALSE", etc.)
  if (StringBooleanSchema.safeParse(value).success) {
    return { type: "boolean", optional: true, description: yamlComment, default: value };
  }

  // Check if it's a string that represents a number ("15", "0", etc.)
  // Only treat non-empty strings that parse as numbers as numbers
  const stringCheckForNumber = StringSchema.safeParse(value);
  if (stringCheckForNumber.success) {
    const trimmed = stringCheckForNumber.data.trim();
    // Don't treat empty strings or purely whitespace as numbers
    if (trimmed !== "" && !isNaN(Number(trimmed)) && isFinite(Number(trimmed))) {
      return { type: "number", optional: true, description: yamlComment, default: value };
    }
  }

  // Check for plain string (strings that don't look like numbers or booleans)
  const stringCheckForPlain = StringSchema.safeParse(value);
  if (stringCheckForPlain.success) {
    // Special case: "default" is often used as a sentinel value in Helm charts
    // that can be overridden with actual typed values (numbers, booleans, etc.)
    if (stringCheckForPlain.data === "default") {
      return { type: "string | number | boolean", optional: true, description: yamlComment, default: value };
    }
    return { type: "string", optional: true, description: yamlComment, default: value };
  }

  // Fallback for any unrecognized type
  console.warn(`Unrecognized value type for: ${String(value)}, using 'unknown'`);
  return { type: "unknown", optional: true, description: yamlComment };
}
