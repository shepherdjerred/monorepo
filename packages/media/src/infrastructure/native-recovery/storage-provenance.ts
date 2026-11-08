import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { MountEvidenceSchema } from "#shared/legacy-observer.ts";
import {
  ApprovedStorageRootsSchema,
  ApprovedStorageRootSchema,
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
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  FinishedCompensationPlexV3Schema,
  CompensationPlexSelectionV3Schema,
} from "#shared/plex-binding/native-version.ts";
import { validateNativePlexReceipt } from "#infrastructure/plex-binding/native/native-version.ts";

const CompensationSelection = z.union([
  NativeCompensationSelectionSchema,
  CompensationPlexSelectionV3Schema,
]);
const CompensationFinished = z.union([
  FinishedNativeCompensationSchema,
  FinishedCompensationPlexV3Schema,
]);

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
  root: Pick<
    ApprovedStorageRoot,
    "rootPath" | "pvcUid" | "volumeName" | "volumePath"
  >,
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
    ? CompensationFinished.parse(receipt.plan.plan).network.identityHash ===
      snapshotHash(
        stableCompensationNetwork(
          CompensationSelection.parse(receipt.selection).networkEvidence,
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
    const network = CompensationSelection.parse(
      receipt.selection,
    ).networkEvidence;
    return {
      configurationDigest: network.mounts.configurationDigest,
      mounts: network.mounts.mounts,
    };
  }
  return NativeSelection.parse(receipt.selection).networkEvidence;
}

type StorageProof = {
  kind: "legacy" | "native";
  id: string;
  planHash: string;
  approved: boolean;
  configurationDigest: string;
  mounts: {
    root: string;
    pvcUid: string;
    volumeName: string;
    volumePath: string;
  }[];
};
function legacyStorageProof(
  receipt: Prisma.MediaHandoffReceiptGetPayload<{ include: { plan: true } }>,
): StorageProof & {
  sourceBindings: z.infer<typeof MountEvidenceSchema>["bindings"];
} {
  if (
    receipt.plan.plan === null ||
    snapshotHash(z.json().parse(receipt.plan.plan)) !== receipt.planHash
  )
    throw new Error("Legacy storage raw approval changed");
  const proof = LegacySelection.parse(receipt.selection).networkEvidence;
  return {
    kind: "legacy",
    id: receipt.id,
    planHash: receipt.planHash,
    approved: approvedPlan(receipt),
    sourceBindings: proof.mounts,
    configurationDigest: proof.configurationDigest,
    mounts: proof.mounts.map((mount) => mount.canonical),
  };
}
function queriedNativeStorageProof(
  receipt: Prisma.NativeRecoveryReceiptGetPayload<{ include: { plan: true } }>,
): StorageProof {
  return {
    kind: "native",
    id: receipt.id,
    planHash: receipt.planHash,
    approved: approvedPlan(receipt),
    ...nativeStorageProof(receipt),
  };
}

/** Pure per-root projection from THIS call's queried and validated immutable receipt graph. */
function assertQueriedStorageRoots(
  roots: ApprovedStorageRoot[],
  rows: StorageRow[],
  proofs: StorageProof[],
) {
  for (const root of roots) {
    const row = rows.find((value) => value.rootPath === root.rootPath);
    if (row === undefined)
      throw new Error("Native storage authority root missing");
    assertStoredEvidence(row);
    if (!rowMatches(root, row))
      throw new Error("Native storage authority identity changed");
    const proof = proofs.find(
      (value) =>
        value.kind === root.receipt.kind && value.id === root.receipt.id,
    );
    if (
      proof === undefined ||
      !proof.approved ||
      proof.planHash !== root.receipt.planHash ||
      proof.configurationDigest !== snapshotHash(LEGACY_OBSERVER_CONFIG) ||
      proof.mounts.filter((mount) => sameStorage(root, mount)).length !== 1
    )
      throw new Error("Native storage approval missing or changed");
  }
  return roots;
}
export async function assertNativeStorageRoots(
  tx: Prisma.TransactionClient,
  raw: unknown,
  budget = new PublicationAuthorityReadBudget(),
): Promise<ApprovedStorageRoot[]> {
  const roots = ApprovedStorageRootsSchema.parse(raw);
  const rows = await tx.mediaStorageAuthority.findMany({
    where: { rootPath: { in: roots.map((root) => root.rootPath) } },
  });
  const proofs = await readStorageProofs(tx, roots, budget);
  return assertQueriedStorageRoots(roots, rows, proofs);
}

async function readStorageProofs(
  tx: Prisma.TransactionClient,
  roots: ApprovedStorageRoot[],
  budget: PublicationAuthorityReadBudget,
  queried: StorageProof[] = [],
) {
  const ids = (kind: "legacy" | "native") => [
    ...new Set(
      roots
        .filter(
          (root) =>
            root.receipt.kind === kind &&
            !queried.some(
              (proof) => proof.kind === kind && proof.id === root.receipt.id,
            ),
        )
        .map((root) => root.receipt.id),
    ),
  ];
  const legacyIds = ids("legacy");
  const nativeIds = ids("native");
  const legacy =
    legacyIds.length === 0
      ? []
      : await tx.mediaHandoffReceipt.findMany({
          where: { id: { in: legacyIds } },
          include: { plan: true },
        });
  budget.consume(legacy.length * 2);
  const native =
    nativeIds.length === 0
      ? []
      : await tx.nativeRecoveryReceipt.findMany({
          where: { id: { in: nativeIds } },
          include: { plan: true },
        });
  budget.consume(native.length * 2);
  for (const receipt of native)
    await validateNativePlexReceipt(tx, receipt, budget);
  return [
    ...queried,
    ...legacy.map((row) => legacyStorageProof(row)),
    ...native.map((row) => queriedNativeStorageProof(row)),
  ];
}

/** Find prior owner-approved receipts, never approve a storage authority row by itself. */
export async function resolveNativeStorageRoots(
  tx: Prisma.TransactionClient,
  budget = new PublicationAuthorityReadBudget(),
  reviewedRoots?: ApprovedStorageRoot[],
): Promise<ApprovedStorageRoot[]> {
  if (reviewedRoots !== undefined)
    return await assertNativeStorageRoots(tx, reviewedRoots, budget);
  const rows = await tx.mediaStorageAuthority.findMany({
    where: { rootPath: { in: ["/data/movies", "/data/tv"] } },
    orderBy: { rootPath: "asc" },
  });
  if (rows.length !== 2)
    throw new Error(
      "Native recovery requires prior approval of both library roots",
    );
  const pinned = new Map<string, ApprovedStorageRoot>();
  const legacyRows = [];
  for (const row of rows) {
    assertStoredEvidence(row);
    const native = NativeStorageAuthoritySchema.safeParse(row.evidence);
    if (!native.success) {
      legacyRows.push(row);
      continue;
    }
    const root = native.data.approvedRoots.find(
      (entry) => entry.rootPath === row.rootPath,
    );
    if (root === undefined || !rowMatches(root, row))
      throw new Error("Native storage pinned approval identity changed");
    pinned.set(row.rootPath, root);
  }
  const legacy = await discoverLegacyStorageProofs(tx, legacyRows, budget);
  const roots = rows.map((row) => {
    const inherited = pinned.get(row.rootPath);
    if (inherited !== undefined) return inherited;
    const base = {
      rootPath: row.rootPath,
      pvcUid: row.pvcUid,
      volumeName: row.volumeName,
      volumePath: row.volumePath,
    };
    const candidate = legacy.find(
      (entry) =>
        entry.approved &&
        legacySourceMatches(legacyStorageIdentity(row), entry.sourceBindings) &&
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
        id: candidate.id,
        planHash: candidate.planHash,
      },
    };
  });
  const parsed = ApprovedStorageRootsSchema.parse(roots);
  const proofs = await readStorageProofs(tx, parsed, budget, legacy);
  return assertQueriedStorageRoots(parsed, rows, proofs);
}

function legacyStorageIdentity(row: StorageRow) {
  const evidence = MountEvidenceSchema.parse(row.evidence);
  const bindings = evidence.bindings.filter(
    (binding) => binding.canonical.root === row.rootPath,
  );
  const binding = bindings[0];
  if (binding === undefined || bindings.length !== 1)
    throw new Error("Legacy storage source identity missing");
  return {
    source: binding.source,
    canonical: {
      root: ApprovedStorageRootSchema.shape.rootPath.parse(row.rootPath),
      pvcUid: row.pvcUid,
      volumeName: row.volumeName,
      volumePath: row.volumePath,
    },
    configurationDigest: evidence.configurationDigest,
  };
}

async function discoverLegacyStorageProofs(
  tx: Prisma.TransactionClient,
  rows: StorageRow[],
  budget: PublicationAuthorityReadBudget,
): Promise<ReturnType<typeof legacyStorageProof>[]> {
  if (rows.length === 0) return [];
  const identities = rows.map((row) => legacyStorageIdentity(row));
  const receipts = await tx.mediaHandoffReceipt.findMany({
    where: {
      OR: identities.map(({ configurationDigest, ...binding }) => ({
        AND: [
          {
            selection: {
              path: ["networkEvidence", "configurationDigest"],
              equals: configurationDigest,
            },
          },
          {
            selection: {
              path: ["networkEvidence", "mounts"],
              array_contains: [binding],
            },
          },
        ],
      })),
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: budget.takeWeighted(2),
    include: { plan: true },
  });
  budget.consume(receipts.length * 2);
  return receipts.map((receipt) => {
    // Validate the literal raw plan before projecting its stored network proof.
    if (
      receipt.plan.plan === null ||
      snapshotHash(z.json().parse(receipt.plan.plan)) !== receipt.planHash ||
      !approvedPlan(receipt)
    )
      throw new Error("Legacy storage eligible approval changed");
    const network = LegacySelection.parse(receipt.selection).networkEvidence;
    if (
      !identities.some((identity) =>
        legacySourceMatches(identity, network.mounts),
      )
    )
      throw new Error("Legacy storage eligible source changed");
    return legacyStorageProof(receipt);
  });
}

function legacySourceMatches(
  identity: ReturnType<typeof legacyStorageIdentity>,
  bindings: z.infer<typeof MountEvidenceSchema>["bindings"],
) {
  return bindings.some(
    (binding) =>
      snapshotHash(z.json().parse(binding.source)) ===
        snapshotHash(z.json().parse(identity.source)) &&
      sameStorage(
        { rootPath: identity.canonical.root, ...identity.canonical },
        binding.canonical,
      ),
  );
}
