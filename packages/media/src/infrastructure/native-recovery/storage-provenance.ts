import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { MountEvidenceSchema } from "#shared/legacy-observer.ts";
import {
  ApprovedStorageRootsSchema,
  CanonicalMountSchema,
  NativeStorageAuthoritySchema,
  type ApprovedStorageRoot,
} from "#shared/canonical-storage.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { LEGACY_OBSERVER_CONFIG } from "#integrations/legacy-observer/config.ts";
import { NativeStoredScopeSchema } from "#shared/native-recovery/lifecycle.ts";
import { NativeCompensationSelectionSchema } from "#shared/native-recovery/compensation-runtime.ts";
import { FinishedNativeCompensationSchema } from "#shared/native-recovery/compensation.ts";
import { stableCompensationNetwork } from "#infrastructure/native-compensation/plan.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

type StorageRow = Prisma.MediaStorageAuthorityGetPayload<Record<string, never>>;
const LegacySelection = z.object({
  networkEvidence: z.object({
    configurationDigest: z.string(),
    mounts: MountEvidenceSchema.shape.bindings,
  }),
});
const NativeSelection = z.object({
  networkEvidence: z.object({
    configurationDigest: z.string(),
    mounts: z.array(CanonicalMountSchema).length(2),
  }),
});
function sameStorage(
  root: ApprovedStorageRoot,
  mount: {
    root: string;
    pvcUid: string;
    volumeName: string;
    volumePath: string;
  },
) {
  return (
    root.rootPath === mount.root &&
    root.pvcUid === mount.pvcUid &&
    root.volumeName === mount.volumeName &&
    root.volumePath === mount.volumePath
  );
}
function rowMatches(root: ApprovedStorageRoot, row: StorageRow) {
  return (
    root.rootPath === row.rootPath &&
    root.pvcUid === row.pvcUid &&
    root.volumeName === row.volumeName &&
    root.volumePath === row.volumePath
  );
}
function assertStoredEvidence(row: StorageRow) {
  const native = NativeStorageAuthoritySchema.safeParse(row.evidence);
  const evidence = native.success
    ? native.data.mounts
    : MountEvidenceSchema.parse(row.evidence);
  const mounts = native.success
    ? native.data.mounts.mounts
    : MountEvidenceSchema.parse(row.evidence).bindings.map(
        (binding) => binding.canonical,
      );
  const matches = mounts.filter(
    (mount) =>
      mount.root === row.rootPath &&
      mount.pvcUid === row.pvcUid &&
      mount.volumeName === row.volumeName &&
      mount.volumePath === row.volumePath,
  );
  if (
    matches.length !== 1 ||
    evidence.configurationDigest !== snapshotHash(LEGACY_OBSERVER_CONFIG)
  )
    throw new Error(
      "Native storage prior authority evidence disagrees with stored identity",
    );
}
function approvedPlan(receipt: {
  planHash: string;
  planId: string;
  recoveryEpoch: number;
  selection: Prisma.JsonValue;
  plan: {
    id: string;
    state: string;
    planHash: string | null;
    plan: Prisma.JsonValue;
    recoveryEpoch: number;
  };
}) {
  const finished = z.object({ network: z.json() }).safeParse(receipt.plan.plan);
  const selection = z
    .object({ networkEvidence: z.json() })
    .safeParse(receipt.selection);
  const compensation =
    z.object({ lifecycleKind: z.string().optional() }).parse(receipt.plan.plan)
      .lifecycleKind === "publication_compensation";
  const matchingNetwork = compensation
    ? FinishedNativeCompensationSchema.parse(receipt.plan.plan).network
        .identityHash ===
      snapshotHash(
        stableCompensationNetwork(
          NativeCompensationSelectionSchema.parse(receipt.selection)
            .networkEvidence,
        ),
      )
    : finished.success &&
      selection.success &&
      snapshotHash(finished.data.network) ===
        snapshotHash(selection.data.networkEvidence);
  return (
    receipt.plan.state === "applied" &&
    receipt.planId === receipt.plan.id &&
    receipt.recoveryEpoch === receipt.plan.recoveryEpoch &&
    receipt.planHash === receipt.plan.planHash &&
    receipt.plan.plan !== null &&
    snapshotHash(z.json().parse(receipt.plan.plan)) === receipt.planHash &&
    matchingNetwork
  );
}
function nativeStorageProof(receipt: {
  selection: Prisma.JsonValue;
  plan: { scope: Prisma.JsonValue };
}) {
  const scope = NativeStoredScopeSchema.parse(receipt.plan.scope);
  if (
    scope.schemaVersion === 2 &&
    scope.lifecycleKind === "publication_compensation"
  ) {
    const network = NativeCompensationSelectionSchema.parse(
      receipt.selection,
    ).networkEvidence;
    return {
      configurationDigest: network.mounts.configurationDigest,
      mounts: network.mounts.mounts,
    };
  }
  return NativeSelection.parse(receipt.selection).networkEvidence;
}
export async function assertNativeStorageRoots(
  tx: Prisma.TransactionClient,
  raw: unknown,
  budget?: PublicationAuthorityReadBudget,
): Promise<ApprovedStorageRoot[]> {
  const roots = ApprovedStorageRootsSchema.parse(raw);
  for (const root of roots) {
    const row = await tx.mediaStorageAuthority.findUniqueOrThrow({
      where: { rootPath: root.rootPath },
    });
    assertStoredEvidence(row);
    if (!rowMatches(root, row))
      throw new Error("Native storage authority identity changed");
    budget?.consume(1);
    if (root.receipt.kind === "legacy") {
      const receipt = await tx.mediaHandoffReceipt.findUniqueOrThrow({
        where: { id: root.receipt.id },
        include: { plan: true },
      });
      const proof = LegacySelection.parse(receipt.selection).networkEvidence;
      if (
        !approvedPlan(receipt) ||
        receipt.planHash !== root.receipt.planHash ||
        proof.configurationDigest !== snapshotHash(LEGACY_OBSERVER_CONFIG) ||
        proof.mounts.filter((mount) => sameStorage(root, mount.canonical))
          .length !== 1
      )
        throw new Error("Native storage legacy approval missing or changed");
    } else {
      const receipt = await tx.nativeRecoveryReceipt.findUniqueOrThrow({
        where: { id: root.receipt.id },
        include: { plan: true },
      });
      const proof = nativeStorageProof(receipt);
      if (
        !approvedPlan(receipt) ||
        receipt.planHash !== root.receipt.planHash ||
        proof.configurationDigest !== snapshotHash(LEGACY_OBSERVER_CONFIG) ||
        proof.mounts.filter((mount) => sameStorage(root, mount)).length !== 1
      )
        throw new Error("Native storage native approval missing or changed");
    }
  }
  return roots;
}

/** Find prior owner-approved receipts, never approve a storage authority row by itself. */
export async function resolveNativeStorageRoots(
  tx: Prisma.TransactionClient,
  budget?: PublicationAuthorityReadBudget,
): Promise<ApprovedStorageRoot[]> {
  const rows = await tx.mediaStorageAuthority.findMany({
    where: { rootPath: { in: ["/data/movies", "/data/tv"] } },
    orderBy: { rootPath: "asc" },
  });
  if (rows.length !== 2)
    throw new Error(
      "Native recovery requires prior approval of both library roots",
    );
  const legacy = await tx.mediaHandoffReceipt.findMany({
    orderBy: { createdAt: "desc" },
    take: budget?.take ?? 100,
    include: { plan: true },
  });
  budget?.consume(legacy.length);
  const native = await tx.nativeRecoveryReceipt.findMany({
    orderBy: { createdAt: "desc" },
    take: budget?.take ?? 100,
    include: { plan: true },
  });
  budget?.consume(native.length);
  const roots = rows.map((row) => {
    const base = {
      rootPath: row.rootPath,
      pvcUid: row.pvcUid,
      volumeName: row.volumeName,
      volumePath: row.volumePath,
    };
    const candidate = [
      ...native.map((receipt) => ({
        kind: "native" as const,
        receipt,
        mounts: nativeStorageProof(receipt).mounts,
      })),
      ...legacy.map((receipt) => ({
        kind: "legacy" as const,
        receipt,
        mounts: LegacySelection.parse(
          receipt.selection,
        ).networkEvidence.mounts.map((mount) => mount.canonical),
      })),
    ].find(
      (entry) =>
        approvedPlan(entry.receipt) &&
        entry.mounts.some(
          (mount) =>
            mount.root === base.rootPath &&
            mount.pvcUid === base.pvcUid &&
            mount.volumeName === base.volumeName &&
            mount.volumePath === base.volumePath,
        ),
    );
    if (candidate === undefined)
      throw new Error(
        "Native recovery storage has no matching durable owner-approved receipt",
      );
    return {
      ...base,
      receipt: {
        kind: candidate.kind,
        id: candidate.receipt.id,
        planHash: candidate.receipt.planHash,
      },
    };
  });
  return assertNativeStorageRoots(tx, roots, budget);
}
