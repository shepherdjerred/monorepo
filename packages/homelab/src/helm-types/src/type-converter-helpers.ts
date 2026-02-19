import type {
  JSONSchemaProperty,
  TypeScriptInterface,
  TypeProperty,
} from "./types.ts";
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
export function inferPrimitiveType(value: unknown, yamlComment?: string): TypeProperty {
  if (ActualBooleanSchema.safeParse(value).success) {
    return { type: "boolean", optional: true, description: yamlComment, default: value };
  }

  if (ActualNumberSchema.safeParse(value).success) {
    return { type: "number", optional: true, description: yamlComment, default: value };
  }

  if (StringBooleanSchema.safeParse(value).success) {
    return { type: "boolean", optional: true, description: yamlComment, default: value };
  }

  const stringCheckForNumber = StringSchema.safeParse(value);
  if (stringCheckForNumber.success) {
    const trimmed = stringCheckForNumber.data.trim();
    if (trimmed !== "" && !Number.isNaN(Number(trimmed)) && Number.isFinite(Number(trimmed))) {
      return { type: "number", optional: true, description: yamlComment, default: value };
    }
  }

  const stringCheckForPlain = StringSchema.safeParse(value);
  if (stringCheckForPlain.success) {
    if (stringCheckForPlain.data === "default") {
      return { type: "string | number | boolean", optional: true, description: yamlComment, default: value };
    }
    return { type: "string", optional: true, description: yamlComment, default: value };
  }

  console.warn(`Unrecognized value type for: ${String(value)}, using 'unknown'`);
  return { type: "unknown", optional: true, description: yamlComment };
}

/**
 * Augment a Kubernetes resource spec interface with both requests and limits.
 * If only one is present, copy its type structure to the other.
 */
export function augmentK8sResourceSpec(iface: TypeScriptInterface): void {
  const hasRequests = "requests" in iface.properties;
  const hasLimits = "limits" in iface.properties;

  // If we have requests but not limits, add limits with the same structure
  if (hasRequests && !hasLimits) {
    const requestsProp = iface.properties["requests"];
    if (requestsProp) {
      // Create limits property with the same type but different name for the nested interface
      const limitsTypeName = requestsProp.type.replace("Requests", "Limits");

      // If there's a nested interface, create a copy for limits
      if (requestsProp.nested) {
        const limitsNested: TypeScriptInterface = {
          name: limitsTypeName,
          properties: { ...requestsProp.nested.properties },
          allowArbitraryProps: requestsProp.nested.allowArbitraryProps,
        };
        iface.properties["limits"] = {
          type: limitsTypeName,
          optional: true,
          nested: limitsNested,
          description: "Kubernetes resource limits (memory, cpu, etc.)",
        };
      } else {
        // No nested interface, just copy the type
        iface.properties["limits"] = {
          type: requestsProp.type,
          optional: true,
          description: "Kubernetes resource limits (memory, cpu, etc.)",
        };
      }
    }
  }

  // If we have limits but not requests, add requests with the same structure
  if (hasLimits && !hasRequests) {
    const limitsProp = iface.properties["limits"];
    if (limitsProp) {
      const requestsTypeName = limitsProp.type.replace("Limits", "Requests");

      if (limitsProp.nested) {
        const requestsNested: TypeScriptInterface = {
          name: requestsTypeName,
          properties: { ...limitsProp.nested.properties },
          allowArbitraryProps: limitsProp.nested.allowArbitraryProps,
        };
        iface.properties["requests"] = {
          type: requestsTypeName,
          optional: true,
          nested: requestsNested,
          description: "Kubernetes resource requests (memory, cpu, etc.)",
        };
      } else {
        iface.properties["requests"] = {
          type: limitsProp.type,
          optional: true,
          description: "Kubernetes resource requests (memory, cpu, etc.)",
        };
      }
    }
  }
}
