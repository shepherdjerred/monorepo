import { z } from "zod";
import { canonicalJson } from "./canonical-json.ts";

const DEFAULT_MAX_REQUEST_BYTES = 750_000;
const SERIALIZED_REQUEST_ID = "00000000-0000-0000-0000-000000000000";
const SERIALIZED_OPERATION_ID = "00000000-0000-0000-0000-000000000000";
const SYNC_WAVE_ANNOTATION = "argocd.argoproj.io/sync-wave";
const SYNC_WAVE_PATTERN = /^[+-]?\d+$/;

export const SYNC_REQUEST_ID_INFO_NAME = "ci.sjer.red/request-id";
export const SYNC_OPERATION_ID_INFO_NAME = "ci.sjer.red/operation-id";
export const SYNC_REVISION_INFO_NAME = "ci.sjer.red/revision";
export const ROOT_RELEASE_PHASE_INFO_NAME = "ci.sjer.red/root-release-phase";

export type RootReleasePhase = "stage" | "batch" | "prune";

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

const OperationInfoSchema = z
  .object({
    info: z
      .array(
        z.object({
          name: z.string(),
          value: z.string(),
        }),
      )
      .optional(),
  })
  .loose();

const OperationSyncRevisionSchema = z
  .object({
    sync: z
      .object({
        revision: z.string().optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

const SyncWaveManifestSchema = z.object({
  metadata: z.object({
    annotations: z.record(z.string(), z.string()).optional(),
  }),
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

function serializedRequestBytes(
  batch: ManifestOverrideBatch,
  revision: string | undefined,
  rootReleasePhase: RootReleasePhase | undefined,
): number {
  return new TextEncoder().encode(
    JSON.stringify({
      prune: false,
      infos: [
        {
          name: SYNC_REQUEST_ID_INFO_NAME,
          value: SERIALIZED_REQUEST_ID,
        },
        {
          name: SYNC_OPERATION_ID_INFO_NAME,
          value: SERIALIZED_OPERATION_ID,
        },
        ...(revision === undefined
          ? []
          : [{ name: SYNC_REVISION_INFO_NAME, value: revision }]),
        ...(rootReleasePhase === undefined
          ? []
          : [
              {
                name: ROOT_RELEASE_PHASE_INFO_NAME,
                value: rootReleasePhase,
              },
            ]),
      ],
      ...(revision === undefined ? {} : { revision }),
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

function manifestSyncWave(override: ManifestOverride): number {
  const parsed: unknown = JSON.parse(override.manifest);
  const annotation =
    SyncWaveManifestSchema.parse(parsed).metadata.annotations?.[
      SYNC_WAVE_ANNOTATION
    ];
  if (annotation === undefined) {
    return 0;
  }
  const wave = Number(annotation);
  if (!SYNC_WAVE_PATTERN.test(annotation) || !Number.isSafeInteger(wave)) {
    throw new Error(
      `manifest override for ${override.resource.kind}/${override.resource.name} has invalid Argo CD sync wave ${JSON.stringify(annotation)}`,
    );
  }
  return wave;
}

function batchSingleSyncWave(
  overrides: readonly ManifestOverride[],
  maxRequestBytes: number,
  revision: string | undefined,
  rootReleasePhase: RootReleasePhase | undefined,
): ManifestOverrideBatch[] {
  const batches: ManifestOverrideBatch[] = [];
  let current: ManifestOverrideBatch = { manifests: [], resources: [] };

  for (const override of overrides) {
    const candidate = appendOverride(current, override);
    if (
      serializedRequestBytes(candidate, revision, rootReleasePhase) <=
      maxRequestBytes
    ) {
      current = candidate;
      continue;
    }
    if (current.manifests.length > 0) {
      batches.push(current);
      current = appendOverride({ manifests: [], resources: [] }, override);
    } else {
      current = candidate;
    }
    if (
      serializedRequestBytes(current, revision, rootReleasePhase) >
      maxRequestBytes
    ) {
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

/**
 * Keep manifest-override operations comfortably below Argo CD's 2 MiB gRPC
 * message ceiling. The application-controller's operation-state update
 * includes both the requested and completed operation, so the manifest
 * payload can appear twice in that message. A 750 kB request budget leaves
 * almost 600 kB for the rest of the Application while staying below 2 MiB.
 * The request is measured after JSON serialization so escaping and resource
 * selectors are included instead of estimated. Each request also contains
 * exactly one Argo CD sync wave. Argo applies every target in a wave before it
 * waits for health, so a degraded resource cannot strand later-wave targets
 * inside the same manifest-override operation.
 */
export function batchManifestOverrides(
  overrides: readonly ManifestOverride[],
  options: {
    readonly maxRequestBytes?: number;
    readonly revision?: string;
    readonly rootReleasePhase?: RootReleasePhase;
  } = {},
): ManifestOverrideBatch[] {
  const maxRequestBytes = options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES;
  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes <= 0) {
    throw new Error("maxRequestBytes must be a positive safe integer");
  }

  const overridesBySyncWave = new Map<number, ManifestOverride[]>();
  for (const override of overrides) {
    const wave = manifestSyncWave(override);
    const waveOverrides = overridesBySyncWave.get(wave) ?? [];
    waveOverrides.push(override);
    overridesBySyncWave.set(wave, waveOverrides);
  }
  return [...overridesBySyncWave.entries()]
    .sort(([leftWave], [rightWave]) => leftWave - rightWave)
    .flatMap(([, waveOverrides]) =>
      batchSingleSyncWave(
        waveOverrides,
        maxRequestBytes,
        options.revision,
        options.rootReleasePhase,
      ),
    );
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

function operationInfoValue(
  operation: Record<string, unknown>,
  infoName: string,
  description: string,
): string | null {
  const matches = (OperationInfoSchema.parse(operation).info ?? []).filter(
    ({ name }) => name === infoName,
  );
  if (matches.length > 1) {
    throw new Error(`Argo operation has multiple CI ${description}s`);
  }
  return matches[0]?.value ?? null;
}

function operationRequestId(operation: Record<string, unknown>): string | null {
  return operationInfoValue(operation, SYNC_REQUEST_ID_INFO_NAME, "request ID");
}

function operationId(operation: Record<string, unknown>): string | null {
  return operationInfoValue(
    operation,
    SYNC_OPERATION_ID_INFO_NAME,
    "operation ID",
  );
}

export function operationInfoRevision(
  operation: Record<string, unknown>,
): string | null {
  return operationInfoValue(operation, SYNC_REVISION_INFO_NAME, "revision");
}

export function operationRevision(
  operation: Record<string, unknown>,
): string | undefined {
  const directRevision =
    OperationSyncRevisionSchema.parse(operation).sync?.revision;
  const persistedRevision = operationInfoRevision(operation) ?? undefined;
  if (
    directRevision !== undefined &&
    persistedRevision !== undefined &&
    directRevision !== persistedRevision
  ) {
    throw new Error(
      `Argo operation revision mismatch: sync revision ${directRevision} does not match CI revision ${persistedRevision}`,
    );
  }
  return directRevision ?? persistedRevision;
}

export function requestedOperationRequestId(application: unknown): string {
  const operation = ApplicationOperationSchema.parse(application).operation;
  if (operation === undefined) {
    throw new Error("Argo sync response is missing the requested operation");
  }
  const requestId = operationRequestId(operation);
  if (requestId === null) {
    throw new Error("Argo sync response is missing the CI request ID");
  }
  return requestId;
}

export function requestedOperationRevision(application: unknown): string {
  const operation = ApplicationOperationSchema.parse(application).operation;
  if (operation === undefined) {
    throw new Error("Argo sync response is missing the requested operation");
  }
  const persistedRevision = operationInfoRevision(operation);
  if (persistedRevision === null) {
    throw new Error("Argo sync response is missing the CI revision");
  }
  operationRevision(operation);
  return persistedRevision;
}

export function activeOperationRequestId(application: unknown): string | null {
  const operation = ApplicationOperationSchema.parse(application).operation;
  return operation === undefined ? null : operationRequestId(operation);
}

export function completedOperationRequestId(
  application: unknown,
): string | null {
  const operation =
    ApplicationOperationSchema.parse(application).status?.operationState
      ?.operation;
  return operation === undefined ? null : operationRequestId(operation);
}

export function requestedOperationId(application: unknown): string {
  const operation = ApplicationOperationSchema.parse(application).operation;
  if (operation === undefined) {
    throw new Error("Argo sync response is missing the requested operation");
  }
  const id = operationId(operation);
  if (id === null) {
    throw new Error("Argo sync response is missing the CI operation ID");
  }
  return id;
}

export function activeOperationId(application: unknown): string | null {
  const operation = ApplicationOperationSchema.parse(application).operation;
  return operation === undefined ? null : operationId(operation);
}

export function completedOperationId(application: unknown): string | null {
  const operation =
    ApplicationOperationSchema.parse(application).status?.operationState
      ?.operation;
  return operation === undefined ? null : operationId(operation);
}
