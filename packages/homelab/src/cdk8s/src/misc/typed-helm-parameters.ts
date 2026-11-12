/**
 * Utility functions for converting between typed Helm values and ArgoCD parameters
 */

import { z } from "zod";

export type HelmParameter = { name: string; value: string };

/**
 * Convert a typed Helm values object to ArgoCD parameters array (dot notation)
 */
export function valuesToParameters(
  values: Record<string, unknown>,
  prefix = "",
): HelmParameter[] {
  const parameters: HelmParameter[] = [];

  for (const [key, value] of Object.entries(values)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value === null || value === undefined) {
      continue;
    }

    // Use Zod to validate if value is a plain object (not array)
    const ObjectSchema = z.record(z.string(), z.unknown());
    const ArraySchema = z.array(z.unknown());

    const objectParseResult = ObjectSchema.safeParse(value);
    if (objectParseResult.success && !ArraySchema.safeParse(value).success) {
      // Recursively handle nested objects
      parameters.push(...valuesToParameters(objectParseResult.data, fullKey));
    } else {
      // Convert values to strings with proper handling
      let stringValue: string;
      const arrayParseResult = ArraySchema.safeParse(value);
      const nestedObjectResult = z
        .record(z.string(), z.unknown())
        .safeParse(value);

      if (arrayParseResult.success) {
        stringValue = JSON.stringify(arrayParseResult.data);
      } else if (nestedObjectResult.success) {
        stringValue = JSON.stringify(nestedObjectResult.data);
      } else {
        // Handle primitive values - at this point it should be string, number, boolean
        const PrimitiveSchema = z.union([z.string(), z.number(), z.boolean()]);
        const primitiveResult = PrimitiveSchema.safeParse(value);

        stringValue = primitiveResult.success
          ? String(primitiveResult.data)
          : JSON.stringify(value);
      }
      parameters.push({
        name: fullKey,
        value: stringValue,
      });
    }
  }

  return parameters;
}

/**
 * Create typed parameters with validation
 */
export function createTypedParameters(
  values: Record<string, unknown>,
): HelmParameter[] {
  return valuesToParameters(values);
}

import type { HelmChartValuesMap } from "@shepherdjerred/homelab/cdk8s/generated/helm/chart-values-map.ts";

/** A chart with committed, generated values types. */
export type HelmChartName = keyof HelmChartValuesMap;

export type HelmValuesForChart<TChart extends HelmChartName> =
  HelmChartValuesMap[TChart];
