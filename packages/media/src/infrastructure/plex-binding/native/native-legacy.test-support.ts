import { z } from "zod";
import { stat } from "node:fs/promises";
import {
  nativeLocalPath,
  type NativeFileContext,
} from "#automation/native-recovery/files.ts";
import type { Database } from "#infrastructure/database.ts";
import {
  NativeArchiveScopeSchema,
  NativeArchiveFileEvidenceSchema,
  NativeArchiveNetworkEvidenceSchema,
  NativeArchiveBindingSchema,
} from "#shared/native-recovery/archive.ts";
import { FinishedNativeV2Schema } from "#shared/native-recovery/lifecycle.ts";
import {
  stableArchiveFiles,
  stableArchiveNetwork,
} from "#infrastructure/native-archive/plan.ts";
import { nativePhysicalIdentity } from "#infrastructure/native-archive/physical-identity.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";

/** Synthetic historical-format records for dispatch/ACK tests, NOT a captured pre20 producer
 * or physical ownership grant. Only the original v2 shapes/serializers are used at first INSERT.
 * This fixture never invokes a current prepare/apply writer or changes an existing history row. */
export async function syntheticHistoricalArchiveReceipt(
  db: Database,
  input: {
    seedPlanId: string;
    network: unknown;
    context: NativeFileContext;
  },
) {
  const seed = await db.nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: input.seedPlanId },
  });
  const scope = NativeArchiveScopeSchema.parse(seed.scope);
  if (
    scope.files.some(
      (file) =>
        file.authority.kind !== "rebaseline" ||
        file.subtitles.some(
          (subtitle) =>
            subtitle.storageKind !== "sidecar" ||
            subtitle.path === null ||
            subtitle.checksum === null,
        ),
    ) ||
    scope.subtitlePolicies.some((policy) => policy.effective !== null) ||
    scope.terminalDependencies.length > 0 ||
    (scope.supersessions?.length ?? 0) !== 0
  )
    throw new Error(
      "Historical format fixture requires the explicit simple archive case",
    );
  const planId = crypto.randomUUID(),
    receiptId = crypto.randomUUID(),
    operationId = crypto.randomUUID();
  const capturedAt = "2020-01-01T00:00:00.000Z",
    expiresAt = "2020-01-01T00:01:00.000Z";
  const source = NativeArchiveNetworkEvidenceSchema.parse(input.network);
  const network = NativeArchiveNetworkEvidenceSchema.parse({
    ...source,
    planId,
    capturedAt,
    expiresAt,
    quiescence: { ...source.quiescence, capturedAt, expiresAt },
    mounts: { ...source.mounts, capturedAt, expiresAt },
  });
  const subtitles = new Map<
    string,
    Awaited<ReturnType<typeof historicalSidecar>>
  >();
  for (const file of scope.files)
    for (const subtitle of file.subtitles)
      subtitles.set(
        subtitle.id,
        await historicalSidecar(input.context, subtitle),
      );
  const files = NativeArchiveFileEvidenceSchema.parse({
    schemaVersion: 2,
    lifecycleKind: "superseded_archive",
    planId,
    recoveryEpoch: seed.recoveryEpoch,
    workerPodUid: "synthetic-historical-format-worker",
    capturedAt,
    files: scope.files.map((file, index) => ({
      assetId: file.assetId,
      canonicalPath: file.canonicalPath,
      checksum: file.checksum,
      sizeBytes: file.sizeBytes,
      // Explicit synthetic audit identities. No fresh producer consumes this fixture as physical proof.
      identity: {
        device: "1",
        inode: String(index + 100),
        mtimeNs: "1",
        ctimeNs: "1",
        ancestors: [
          { path: `/data/${file.libraryKind}`, device: "1", inode: "2" },
        ],
      },
      properties: file.properties,
      journalDigest: identityHash([]),
      subtitles: file.subtitles.map((subtitle) => {
        const evidence = subtitles.get(subtitle.id);
        if (evidence === undefined)
          throw new Error("Historical sidecar evidence missing");
        return evidence;
      }),
      sidecarInventory: [],
    })),
    terminalEvidence: [],
    artifactAbsences: [],
  });
  const stableFiles = stableArchiveFiles(files),
    stableNetwork = stableArchiveNetwork(network);
  const finished = FinishedNativeV2Schema.parse({
    schemaVersion: 2,
    lifecycleKind: "superseded_archive",
    scopeHash: identityHash(seed.scope),
    network: stableNetwork,
    files: stableFiles,
  });
  const planHash = identityHash(finished);
  const bindings = scope.files.map((file) => {
    const evidence = files.files.find(
      (value) => value.assetId === file.assetId,
    );
    if (evidence === undefined)
      throw new Error("Historical literal evidence missing");
    return NativeArchiveBindingSchema.parse({
      assetId: file.assetId,
      beforeVersion: file.assetVersion,
      assetVersion: file.assetVersion + 1,
      checksum: file.checksum,
      mediaIds: file.mediaIds,
      ownershipEpoch: seed.recoveryEpoch,
      subtitles: file.subtitles.map((subtitle) => ({
        id: subtitle.id,
        before: {
          version: subtitle.version,
          ownershipEpoch: subtitle.ownershipEpoch,
          videoVersion: subtitle.videoVersion,
        },
        after: {
          version: subtitle.version + 1,
          ownershipEpoch: seed.recoveryEpoch,
          videoVersion: file.assetVersion + 1,
        },
        qualityStatus: subtitle.qualityStatus,
      })),
      physicalIdentityHash: identityHash(nativePhysicalIdentity(evidence)),
    });
  });
  const selection = {
    scope: seed.scope,
    fileEvidence: stableFiles,
    networkEvidence: stableNetwork,
    bindings,
    reusedBindings: [],
    policies: [],
  };
  const payload = {
    kind: "apply_native_archive",
    operationId,
    planId,
    planHash,
    actorId: seed.actorId,
    recoveryEpoch: seed.recoveryEpoch,
  };
  await db.$transaction(async (tx) => {
    await tx.nativeRecoveryPlan.create({
      data: {
        id: planId,
        actorId: seed.actorId,
        restoreOperationId: seed.restoreOperationId,
        recoveryEpoch: seed.recoveryEpoch,
        runtimeVersion: seed.runtimeVersion,
        requestHash: identityHash(scope.request),
        state: "applied",
        scope: z.record(z.string(), z.json()).parse(seed.scope),
        plan: z.record(z.string(), z.json()).parse(finished),
        planHash,
        expiresAt: new Date(expiresAt),
      },
    });
    await tx.operation.create({
      data: {
        id: operationId,
        idempotencyKey: `synthetic-historical-archive:${operationId}`,
        kind: "apply_native_archive",
        status: "completed",
        targetId: planId,
        userId: seed.actorId,
        payload,
      },
    });
    await tx.nativeRecoveryReceipt.create({
      data: {
        id: receiptId,
        planId,
        actorId: seed.actorId,
        recoveryEpoch: seed.recoveryEpoch,
        previousRuntimeVersion: seed.runtimeVersion,
        runtimeVersion: seed.runtimeVersion + 1,
        planHash,
        selection: z.record(z.string(), z.json()).parse(selection),
      },
    });
  });
  const snapshot = async () => {
    const [plan, receipt, operation] = await Promise.all([
      db.nativeRecoveryPlan.findUniqueOrThrow({ where: { id: planId } }),
      db.nativeRecoveryReceipt.findUniqueOrThrow({ where: { id: receiptId } }),
      db.operation.findUniqueOrThrow({ where: { id: operationId } }),
    ]);
    return {
      scope: plan.scope,
      finished: plan.plan,
      planHash: plan.planHash,
      selection: receipt.selection,
      receiptPlanHash: receipt.planHash,
      payload: operation.payload,
      batches: await db.nativePlexProofBatch.count({ where: { planId } }),
      observations: await db.nativeRecoveryObservation.count({
        where: { planId },
      }),
    };
  };
  return { receiptId, input: { planId, operationId, planHash }, snapshot };
}

async function historicalSidecar(
  context: NativeFileContext,
  subtitle: z.infer<
    typeof NativeArchiveScopeSchema
  >["files"][number]["subtitles"][number],
) {
  if (
    subtitle.path === null ||
    subtitle.checksum === null ||
    subtitle.storageKind !== "sidecar"
  )
    throw new Error(
      "Historical format fixture supports explicit complete sidecars only",
    );
  const file = await stat(nativeLocalPath(context, subtitle.path));
  return {
    id: subtitle.id,
    assetId: subtitle.assetId,
    snapshotHash: identityHash(subtitle),
    videoChecksum: subtitle.videoChecksum,
    canonicalPath: subtitle.path,
    checksum: subtitle.checksum,
    sizeBytes: String(file.size),
    identity: {
      device: "1",
      inode: "200",
      mtimeNs: "1",
      ctimeNs: "1",
      ancestors: [{ path: "/data", device: "1", inode: "2" }],
    },
    storageKind: "sidecar",
    qualityStatus: subtitle.qualityStatus,
    stream: null,
  };
}
