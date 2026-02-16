/**
 * @homelab/helm-types
 *
 * A library for generating TypeScript types from Helm chart values.
 *
 * Core functionality:
 * - Fetch Helm charts from repositories
 * - Parse values.yaml and values.schema.json
 * - Generate TypeScript interfaces with JSDoc comments
 * - Support for nested objects, arrays, and unions
 *
 * This is a general-purpose library that can be used with any Helm chart.
 * Application-specific logic should be kept in your application code.
 */
export * from "./helm-types.ts";
