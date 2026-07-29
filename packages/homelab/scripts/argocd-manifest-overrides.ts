import { z } from "zod";

const DEFAULT_MAX_REQUEST_BYTES = 1_500_000;

const ApplicationOperationSchema = z.object({
  operation: z.record(z.string(), z.unknown()).optional(),
  status: z
    .object({
      operationState: z
        .object({
          operation: z.record(z.string(), z.unknown()).optional(),
        })
        .optional(),
    })
    .optional(),
});

export type SyncOperationResource = {
  group: string;
  kind: string;
  name: string;
  namespace?: string;
};

export type ManifestOverride = {
  manifest: string;
  resource: SyncOperationResource;
};

export type ManifestOverrideBatch = {
  manifests: string[];
  resources: SyncOperationResource[];
};

function serializedRequestBytes(batch: ManifestOverrideBatch): number {
  return new TextEncoder().encode(
    JSON.stringify({
      prune: false,
      manifests: batch.manifests,
      resources: batch.resources,
    }),
  ).byteLength;
}

function appendOverride(
  batch: ManifestOverrideBatch,
  override: ManifestOverride,
): ManifestOverrideBatch {
  return {
    manifests: [...batch.manifests, override.manifest],
    resources: [...batch.resources, override.resource],
  };
}

/**
 * Keep manifest-override operations comfortably below Argo CD's 2 MiB gRPC
 * message ceiling. The request is measured after JSON serialization so
 * escaping and resource selectors are included instead of estimated.
 */
export function batchManifestOverrides(
  overrides: readonly ManifestOverride[],
  maxRequestBytes = DEFAULT_MAX_REQUEST_BYTES,
): ManifestOverrideBatch[] {
  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes <= 0) {
    throw new Error("maxRequestBytes must be a positive safe integer");
  }

  const batches: ManifestOverrideBatch[] = [];
  let current: ManifestOverrideBatch = { manifests: [], resources: [] };

  for (const override of overrides) {
    const candidate = appendOverride(current, override);
    if (serializedRequestBytes(candidate) <= maxRequestBytes) {
      current = candidate;
      continue;
    }
    if (current.manifests.length > 0) {
      batches.push(current);
      current = appendOverride({ manifests: [], resources: [] }, override);
    } else {
      current = candidate;
    }
    if (serializedRequestBytes(current) > maxRequestBytes) {
      throw new Error(
        `manifest override for ${override.resource.kind}/${override.resource.name} exceeds the request budget`,
      );
    }
  }

  if (current.manifests.length > 0) {
    batches.push(current);
  }
  return batches;
}

function canonicalJson(value: unknown): string {
  switch (typeof value) {
    case "boolean":
    case "number":
    case "string":
      return JSON.stringify(value);
    case "object":
      if (value === null) {
        return "null";
      }
      if (Array.isArray(value)) {
        return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
      }
      return `{${Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
        .join(",")}}`;
    case "bigint":
    case "function":
    case "symbol":
    case "undefined":
      throw new Error(`unsupported operation value type: ${typeof value}`);
  }
}

export function requestedOperationIdentity(application: unknown): string {
  const operation = ApplicationOperationSchema.parse(application).operation;
  if (operation === undefined) {
    throw new Error("Argo sync response is missing the requested operation");
  }
  return canonicalJson(operation);
}

export function completedOperationIdentity(
  application: unknown,
): string | null {
  const operation =
    ApplicationOperationSchema.parse(application).status?.operationState
      ?.operation;
  if (operation === undefined) {
    return null;
  }
  return canonicalJson(operation);
}
