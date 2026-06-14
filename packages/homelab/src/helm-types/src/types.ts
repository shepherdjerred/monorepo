// Core type definitions for Helm chart type generation

export type ChartInfo = {
  name: string;
  repoUrl: string;
  version: string;
  chartName: string; // The actual chart name (may differ from versions.ts key)
  // When true, the chart is served from an OCI registry: fetch via
  // `helm pull oci://<repoUrl>/<chartName>` instead of `helm repo add` + pull.
  oci?: boolean;
};

export type JSONSchemaProperty = {
  type?: string | string[];
  enum?: unknown[];
  oneOf?: JSONSchemaProperty[];
  anyOf?: JSONSchemaProperty[];
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  description?: string;
  default?: unknown;
};

export type TypeScriptInterface = {
  name: string;
  properties: Record<string, TypeProperty>;
  /**
   * If true, add an index signature to allow arbitrary additional properties
   * Useful for config maps, arbitrary key-value stores, etc.
   */
  allowArbitraryProps?: boolean;
};

export type TypeProperty = {
  type: string;
  optional: boolean;
  description?: string;
  default?: unknown;
  nested?: TypeScriptInterface;
};
