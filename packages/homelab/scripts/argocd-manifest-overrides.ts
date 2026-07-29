const DEFAULT_MAX_REQUEST_BYTES = 1_500_000;

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
