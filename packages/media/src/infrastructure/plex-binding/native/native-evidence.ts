import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { NativeRecoveryNetworkEvidenceSchema } from "#shared/native-recovery.ts";
import { NativeQuarantineNetworkEvidenceSchema } from "#shared/native-recovery/quarantine.ts";
import {
  NativeArchiveNetworkEvidenceSchema,
  NativeArchiveCleanupNetworkEvidenceSchema,
} from "#shared/native-recovery/archive.ts";
import {
  NativeCompensationNetworkEvidenceSchema,
  NativeCompensationExecutionNetworkEvidenceSchema,
} from "#shared/native-recovery/compensation.ts";
import type {
  NativePlexProofParent,
  NativePlexObservation,
  NativePlexNetworkEvidence,
  NativePlexProofRef,
} from "#shared/plex-binding/native.ts";
import { stableArchiveNetwork } from "#infrastructure/native-archive/plan.ts";
import {
  stableCompensationFiles,
  stableCompensationNetwork,
} from "#shared/plex-binding/native-projections.ts";
import {
  FinishedNativePlexV3Schema,
  NativePlexSelectionV3Schema,
} from "#shared/plex-binding/native-version.ts";
import { NativeStoredScopeSchema } from "#shared/native-recovery/lifecycle.ts";
import type { NativeCatalogScopeSnapshot } from "#shared/plex-binding/native-scope.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { NativeReceiptReadPort } from "./receipt-port.ts";

/** Reuses only a complete immutable parent; every actual parent lookup remains charged. */
export async function readExecutionNativeReceipt(
  tx: Prisma.TransactionClient,
  input: {
    receiptId: string;
    queried:
      | Prisma.NativeRecoveryReceiptGetPayload<{ include: { plan: true } }>
      | undefined;
    projection: NativeReceiptReadPort | undefined;
  },
  budget: PublicationAuthorityReadBudget,
) {
  if (input.queried !== undefined) return input.queried;
  if (input.projection !== undefined)
    return input.projection.read(tx, input.receiptId, budget);
  const receipt = await tx.nativeRecoveryReceipt.findUniqueOrThrow({
    where: { id: input.receiptId },
    include: { plan: true },
  });
  budget.consume(2);
  return receipt;
}

export function assertExecutionReceiptParent(
  receipt: Prisma.NativeRecoveryReceiptGetPayload<{ include: { plan: true } }>,
  parent: Extract<NativePlexProofParent, { purpose: "native_execution" }>,
) {
  if (
    receipt.id !== parent.receipt.receiptId ||
    receipt.actorId !== receipt.plan.actorId ||
    receipt.planId !== parent.planId ||
    receipt.recoveryEpoch !== parent.recoveryEpoch ||
    receipt.planHash !== parent.receipt.planHash ||
    identityHash(receipt.plan.plan) !== receipt.planHash ||
    identityHash(receipt.selection) !== parent.receipt.selectionHash ||
    receipt.plan.planHash !== receipt.planHash ||
    identityHash(receipt.plan.scope) !== parent.scopeHash
  )
    throw new Error("Native execution proof receipt changed");
}

/** Literal parent validation shared by review readback and execution closure. */
export function parseNativePlexReceipt(
  receipt: Prisma.NativeRecoveryReceiptGetPayload<{ include: { plan: true } }>,
) {
  if (
    receipt.plan.plan === null ||
    receipt.plan.planHash !== receipt.planHash ||
    identityHash(receipt.plan.plan) !== receipt.planHash
  )
    throw new Error("Native raw finished parent hash changed");
  const version = z
    .object({ schemaVersion: z.int() })
    .parse(receipt.plan.plan).schemaVersion;
  if (version === 1 || version === 2) return null;
  if (version !== 3)
    throw new Error("Unsupported native finished plan version");
  const finished = FinishedNativePlexV3Schema.parse(receipt.plan.plan);
  const selection = NativePlexSelectionV3Schema.parse(receipt.selection);
  const scope = NativeStoredScopeSchema.parse(receipt.plan.scope);
  assertReceiptParents(receipt, finished, selection, scope);
  return { receipt, scope, finished, selection };
}

function assertReceiptParents(
  receipt: Prisma.NativeRecoveryReceiptGetPayload<{ include: { plan: true } }>,
  finished: z.infer<typeof FinishedNativePlexV3Schema>,
  selection: z.infer<typeof NativePlexSelectionV3Schema>,
  scope: NativeCatalogScopeSnapshot,
) {
  const scopeHash = identityHash(receipt.plan.scope);
  const lifecycleKind =
    scope.schemaVersion === 1 ? "published" : scope.lifecycleKind;
  const selectedFiles =
    selection.lifecycleKind === "publication_compensation"
      ? stableCompensationFiles(selection.fileEvidence)
      : selection.fileEvidence;
  const selectedNetwork =
    selection.lifecycleKind === "publication_compensation"
      ? {
          identityHash: identityHash(
            stableCompensationNetwork(selection.networkEvidence),
          ),
        }
      : selection.networkEvidence;
  if (
    receipt.plan.id !== receipt.planId ||
    receipt.plan.state !== "applied" ||
    receipt.plan.recoveryEpoch !== receipt.recoveryEpoch ||
    lifecycleKind !== finished.lifecycleKind ||
    receipt.actorId !== receipt.plan.actorId ||
    finished.scopeHash !== scopeHash ||
    identityHash(selection.scope) !== scopeHash ||
    finished.lifecycleKind !== selection.lifecycleKind ||
    identityHash(finished.plex) !== identityHash(selection.plex.approved) ||
    identityHash(finished.files) !== identityHash(selectedFiles) ||
    identityHash(finished.network) !== identityHash(selectedNetwork) ||
    selection.plex.approved.parent.planId !== receipt.planId ||
    selection.plex.applied.parent.planId !== receipt.planId ||
    selection.plex.approved.parent.recoveryEpoch !== receipt.recoveryEpoch ||
    selection.plex.applied.parent.recoveryEpoch !== receipt.recoveryEpoch
  )
    throw new Error(
      "Native v3 receipt lost its exact finished/selection parents",
    );
}

type PairedProof = {
  ref: NativePlexProofRef;
  operationKind: string;
  network: unknown;
  batch: { identityHash: string };
};

export function assertNativeReceiptPair(
  record: NonNullable<ReturnType<typeof parseNativePlexReceipt>>,
  approved: PairedProof,
  applied: PairedProof,
) {
  const kinds = {
    published: ["prepare_native_recovery", "apply_native_recovery"],
    committed_quarantine: [
      "prepare_native_quarantine",
      "apply_native_quarantine",
    ],
    superseded_archive: ["prepare_native_archive", "apply_native_archive"],
    publication_compensation: [
      "prepare_native_compensation",
      "apply_native_compensation",
    ],
  };
  const expected = kinds[record.finished.lifecycleKind];
  if (
    approved.operationKind !== expected[0] ||
    applied.operationKind !== expected[1] ||
    approved.ref.parent.operationId === applied.ref.parent.operationId ||
    approved.ref.batchId === applied.ref.batchId ||
    approved.batch.identityHash !== applied.batch.identityHash ||
    identityHash(
      nativeFinishedNetwork(approved.ref.parent, approved.network),
    ) !== identityHash(record.finished.network) ||
    identityHash(nativeFinishedNetwork(applied.ref.parent, applied.network)) !==
      identityHash(record.finished.network)
  )
    throw new Error(
      "Native v3 paired network identity or prepare/apply operations changed",
    );
}

export function nativeFinishedNetwork(
  parent: NativePlexProofParent,
  raw: unknown,
) {
  const network = stableNativePlexNetwork(parent, raw);
  return parent.lifecycleKind === "publication_compensation"
    ? { identityHash: identityHash(network) }
    : network;
}

export function parseNativePlexNetwork(
  parent: NativePlexProofParent,
  raw: unknown,
): NativePlexNetworkEvidence {
  let network: NativePlexNetworkEvidence;
  switch (parent.networkKind) {
    case "archive_cleanup_network":
      network = NativeArchiveCleanupNetworkEvidenceSchema.parse(raw);
      break;
    case "compensation_network":
      network = NativeCompensationExecutionNetworkEvidenceSchema.parse(raw);
      break;
    case "network":
      switch (parent.lifecycleKind) {
        case "published":
          network = NativeRecoveryNetworkEvidenceSchema.parse(raw);
          break;
        case "committed_quarantine":
          network = NativeQuarantineNetworkEvidenceSchema.parse(raw);
          break;
        case "superseded_archive":
          network = NativeArchiveNetworkEvidenceSchema.parse(raw);
          break;
        case "publication_compensation":
          network = NativeCompensationNetworkEvidenceSchema.parse(raw);
          break;
      }
  }
  if (
    network.planId !== parent.planId ||
    network.recoveryEpoch !== parent.recoveryEpoch
  )
    throw new Error("Native Plex network parent changed");
  if (parent.purpose === "native_execution") {
    const execution = z
      .object({ continuationId: z.uuid(), operationId: z.uuid() })
      .parse(network);
    if (
      execution.continuationId !== parent.continuationId ||
      execution.operationId !== parent.operationId
    )
      throw new Error("Native Plex network coordinator changed");
  }
  return network;
}

/** Stable reviewed identity excludes observation timestamps and inventory counters. */
export function nativePlexIdentityHash(
  parent: NativePlexProofParent,
  raw: unknown,
  plex: NativePlexObservation,
): string {
  const network = stableNativePlexNetwork(parent, raw);
  return identityHash({
    network,
    plex: {
      present: plex.present,
      ...(plex.compensationCatalog === undefined
        ? {}
        : { compensationCatalog: plex.compensationCatalog }),
      ...(plex.canonicalTargets === undefined
        ? {}
        : { canonicalTargets: plex.canonicalTargets }),
      ...(plex.effectiveScope === undefined
        ? {}
        : { effectiveScope: plex.effectiveScope }),
      absent: plex.absent.map(({ assetId, sectionId, canonicalPaths }) => ({
        assetId,
        sectionId,
        canonicalPaths,
      })),
    },
  });
}

export function stableNativePlexNetwork(
  parent: NativePlexProofParent,
  raw: unknown,
) {
  const evidence = parseNativePlexNetwork(parent, raw);
  const stableInput = nativeNetworkReviewBody(parent, evidence);
  let network;
  switch (parent.lifecycleKind) {
    case "superseded_archive":
      network = stableArchiveNetwork(stableInput);
      break;
    case "publication_compensation":
      network = stableCompensationNetwork(stableInput);
      break;
    case "published":
    case "committed_quarantine":
      network = {
        planId: evidence.planId,
        recoveryEpoch: evidence.recoveryEpoch,
        configurationDigest: evidence.mounts.configurationDigest,
        targetsDigest: evidence.quiescence.targetsDigest,
        controllers: evidence.quiescence.controllers,
        mounts: evidence.mounts.mounts,
        plex: evidence.plex,
        torrents: evidence.torrents,
      };
  }
  return network;
}

/** Raw execution evidence is hashed first; only its stable review projection omits these fields. */
function nativeNetworkReviewBody(
  parent: NativePlexProofParent,
  raw: NativePlexNetworkEvidence,
) {
  if (parent.networkKind === "archive_cleanup_network") {
    const {
      continuationId: _continuation,
      operationId: _operation,
      ...review
    } = NativeArchiveCleanupNetworkEvidenceSchema.parse(raw);
    return review;
  }
  if (parent.networkKind === "compensation_network") {
    const {
      continuationId: _continuation,
      operationId: _operation,
      descriptorHash: _descriptor,
      ...review
    } = NativeCompensationExecutionNetworkEvidenceSchema.parse(raw);
    return review;
  }
  return raw;
}
