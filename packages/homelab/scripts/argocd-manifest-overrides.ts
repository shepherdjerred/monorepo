import { z } from "zod";
import { canonicalJson } from "./canonical-json.ts";

const DEFAULT_MAX_REQUEST_BYTES = 1_500_000;
const SERIALIZED_REQUEST_ID = "00000000-0000-0000-0000-000000000000";

export const SYNC_REQUEST_ID_INFO_NAME = "ci.sjer.red/request-id";

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
      infos: [
        {
          name: SYNC_REQUEST_ID_INFO_NAME,
          value: SERIALIZED_REQUEST_ID,
        },
      ],
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
