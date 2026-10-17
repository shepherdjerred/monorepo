import path from "node:path";
import { z } from "zod";
import type { Prisma, SubtitleAsset } from "#generated/prisma/client.ts";
import { SubtitleReplacementSnapshotSchema } from "#shared/subtitle-replacement.ts";
import type { NativeTerminalDescriptor } from "#shared/native-recovery/terminal.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeSubtitleSnapshot } from "#automation/native-subtitles/snapshot.ts";
import {
  NativeSubtitleSnapshotSchema,
  type NativeSubtitleSnapshot,
} from "#shared/native-subtitles.ts";
import type { TerminalSubtitleBindingSchema } from "./terminal-rebinding.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { PublicationSubtitleLineageSchema } from "#shared/publication-proof/subtitle-lineage.ts";

const Receipt = z.object({
  schemaVersion: z.literal(1),
  snapshotHash: z.string(),
  recoveryEpoch: z.int(),
  oldSubtitleId: z.uuid(),
  candidateSubtitleId: z.uuid(),
  videoVersion: z.int(),
  oldPath: z.string(),
  archivePath: z.string(),
  importOperationId: z.string(),
  rollbackOperationId: z.string(),
  artifacts: z
    .array(
      z.object({
        name: z.enum([
          "source",
          "staged",
          "partial",
          "oldArchive",
          "rejected",
          "rollbackStaged",
        ]),
        path: z.string(),
        identity: z.object({ checksum: z.string() }).nullable(),
      }),
    )
    .length(6),
});
type Input = {
  subtitleId: string;
  checksum: string;
  canonicalPath: string;
  libraryKind: "movies" | "tv";
  asset: {
    id: string;
    path: string;
    checksum: string | null;
    version: number;
    ownershipEpoch: number;
    coverage: { mediaId: string; current: boolean }[];
  };
  videoBindings: { version: number; epoch: number }[];
  subtitleRenewals?: {
    bindings: z.infer<typeof TerminalSubtitleBindingSchema>[];
    snapshots: NativeSubtitleSnapshot[];
  }[];
};

/** A settled replacement explains a changed caption, without adopting any of its archives. */
export async function terminalSubtitleChain(
  tx: Prisma.TransactionClient,
  input: Input,
  budget?: PublicationAuthorityReadBudget,
) {
  const files: NativeTerminalDescriptor["files"] = [];
  const journals: NativeTerminalDescriptor["journals"] = [];
  const history = [];
  const artifactIdentities = [];
  let id = input.subtitleId;
  let checksum = input.checksum;
  let expected: NativeSubtitleSnapshot | undefined;
  const seen = new Set<string>();
  for (let index = 0; index <= 20; index++) {
    if (seen.has(id))
      throw new Error("Native subtitle replacement chain is cyclic");
    seen.add(id);
    const subtitle = await tx.subtitleAsset.findUniqueOrThrow({
      where: { id },
    });
    if (isCurrent(subtitle, input, checksum)) {
      const current = nativeSubtitleSnapshot(subtitle);
      assertRenewedSubtitle(expected, current, input);
      return { files, journals, history, current, artifactIdentities };
    }
    if (index === 20) break;
    const rows = await tx.subtitleReplacement.findMany({
      where: { oldSubtitleId: id, receipt: { outcome: "installed" } },
      include: { receipt: true },
      take: Math.min(2, budget?.take ?? 2),
    });
    budget?.consume(rows.length);
    const row = rows[0];
    if (row === undefined || rows.length !== 1 || row.receipt === null)
      throw new Error(
        "Native restored sidecar has no exact settled replacement",
      );
    const scope = SubtitleReplacementSnapshotSchema.parse(row.snapshot);
    const receipt = Receipt.parse(row.receipt.evidence);
    if (
      expected !== undefined &&
      snapshotHash(
        renewSubtitle(expected, input, scope.asset.version, row.recoveryEpoch),
      ) !== snapshotHash({ ...scope.old, path: input.canonicalPath })
    )
      throw new Error("Native replacement successor snapshot changed");
    validateReplacement({ input, row, scope, receipt, subtitle, checksum });
    const artifacts = replacementArtifacts({ input, row, scope, receipt });
    files.push(...artifacts.files);
    journals.push(...artifacts.journals);
    if (row.cleanupState !== "cleaned")
      artifactIdentities.push(
        ...receiptArtifactIdentities(row.receipt.evidence, receipt, artifacts),
      );
    history.push({
      row,
      subtitle: {
        id: subtitle.id,
        version: subtitle.version,
        state: subtitle.state,
        ownershipEpoch: subtitle.ownershipEpoch,
        videoVersion: subtitle.videoVersion,
        path: subtitle.path,
        checksum: subtitle.checksum,
        qualityStatus: subtitle.qualityStatus,
        provenance: subtitle.provenance,
        matchingEvidence: subtitle.matchingEvidence,
      },
    });
    id = row.candidateSubtitleId;
    checksum = z.string().parse(scope.candidate.checksum);
    expected = NativeSubtitleSnapshotSchema.parse({
      ...scope.candidate,
      state: "installed",
      path: input.canonicalPath,
      version: scope.candidate.version + 1,
    });
  }
  throw new Error("Native subtitle replacement chain exceeds bounded lookup");
}

function assertRenewedSubtitle(
  expected: NativeSubtitleSnapshot | undefined,
  current: NativeSubtitleSnapshot,
  input: Input,
) {
  if (expected === undefined) return;
  if (
    snapshotHash(
      renewSubtitle(
        expected,
        input,
        current.videoVersion,
        current.ownershipEpoch,
      ),
    ) !== snapshotHash(current)
  )
    throw new Error(
      "Native replacement current subtitle lacks exact renewal binding",
    );
}

function renewSubtitle(
  original: NativeSubtitleSnapshot,
  input: Input,
  version: number,
  epoch: number,
) {
  let current = original;
  const renewals = (input.subtitleRenewals ?? [])
    .flatMap((item) => {
      const binding = item.bindings.find((row) => row.id === original.id);
      const snapshot = item.snapshots.find((row) => row.id === original.id);
      return binding === undefined || snapshot === undefined
        ? []
        : [{ binding, snapshot }];
    })
    .sort(
      (a, b) => a.binding.after.videoVersion - b.binding.after.videoVersion,
    );
  for (const { binding, snapshot } of renewals) {
    if (
      binding.after.videoVersion <= current.videoVersion ||
      binding.after.videoVersion > version
    )
      continue;
    if (
      snapshotHash(current) !== snapshotHash(snapshot) ||
      binding.before.version !== current.version ||
      binding.before.ownershipEpoch !== current.ownershipEpoch ||
      binding.before.videoVersion !== current.videoVersion
    )
      throw new Error("Native replacement subtitle renewal snapshot changed");
    current = { ...current, ...binding.after };
  }
  if (current.videoVersion !== version || current.ownershipEpoch !== epoch)
    throw new Error("Native replacement subtitle renewal is unproven");
  return current;
}

function isCurrent(row: SubtitleAsset, input: Input, checksum: string) {
  return (
    row.assetId === input.asset.id &&
    row.state === "installed" &&
    row.storageKind === "sidecar" &&
    row.path === input.canonicalPath &&
    row.checksum === checksum &&
    row.videoChecksum === input.asset.checksum &&
    row.videoVersion === input.asset.version &&
    row.ownershipEpoch === input.asset.ownershipEpoch
  );
}
type ReplacementInput = {
  input: Input;
  row: Prisma.SubtitleReplacementGetPayload<{ include: { receipt: true } }>;
  scope: z.infer<typeof SubtitleReplacementSnapshotSchema>;
  receipt: z.infer<typeof Receipt>;
};
function validateReplacement({
  input,
  row,
  scope,
  receipt,
  subtitle,
  checksum,
}: ReplacementInput & { subtitle: SubtitleAsset; checksum: string }) {
  validateSnapshot({ input, row, scope, receipt }, checksum);
  validateReceipt({ input, row, scope, receipt });
  validateArchive({ input, row, scope, receipt, subtitle, checksum });
}

function validateSnapshot(
  { input, row, scope }: ReplacementInput,
  checksum: string,
) {
  if (
    row.state !== "applied" ||
    row.reservationActive ||
    !["pending", "cleaned"].includes(row.cleanupState) ||
    row.assetId !== input.asset.id ||
    scope.asset.id !== input.asset.id ||
    scope.asset.checksum !== input.asset.checksum ||
    !input.videoBindings.some(
      (binding) =>
        binding.version === scope.asset.version &&
        binding.epoch === row.recoveryEpoch,
    ) ||
    scope.recoveryEpoch !== row.recoveryEpoch ||
    scope.asset.ownershipEpoch !== row.recoveryEpoch ||
    scope.libraryKind !== input.libraryKind ||
    scope.old.id !== row.oldSubtitleId ||
    scope.candidate.id !== row.candidateSubtitleId ||
    scope.old.checksum !== checksum ||
    scope.old.path !== scope.destination ||
    path.relative(path.dirname(scope.asset.path), scope.destination) !==
      path.relative(path.dirname(input.asset.path), input.canonicalPath) ||
    snapshotHash(scope) !== row.snapshotHash
  )
    throw new Error("Native subtitle replacement snapshot binding changed");
  const actual = input.asset.coverage
    .filter((item) => item.current)
    .map((item) => item.mediaId)
    .sort();
  if (
    snapshotHash(actual) !==
    snapshotHash(scope.asset.coverage.map((item) => item.mediaId).sort())
  )
    throw new Error("Native subtitle replacement coverage changed");
}

function validateReceipt({ row, scope, receipt }: ReplacementInput) {
  if (
    receipt.snapshotHash !== row.snapshotHash ||
    receipt.recoveryEpoch !== row.recoveryEpoch ||
    receipt.videoVersion !== scope.asset.version ||
    receipt.oldSubtitleId !== row.oldSubtitleId ||
    receipt.candidateSubtitleId !== row.candidateSubtitleId ||
    receipt.oldPath !== scope.destination ||
    receipt.importOperationId !== row.importOperationId ||
    receipt.rollbackOperationId !== row.rollbackOperationId
  )
    throw new Error("Native subtitle replacement receipt binding changed");
}

function validateArchive({
  input,
  row,
  scope,
  subtitle,
  checksum,
}: ReplacementInput & { subtitle: SubtitleAsset; checksum: string }) {
  const cleaned = row.cleanupState === "cleaned";
  if (
    subtitle.state !== (cleaned ? "purged" : "superseded") ||
    subtitle.assetId !== input.asset.id ||
    subtitle.checksum !== checksum ||
    subtitle.videoChecksum !== input.asset.checksum ||
    subtitle.videoVersion !== scope.asset.version ||
    subtitle.ownershipEpoch !== row.recoveryEpoch ||
    subtitle.version !== scope.old.version + (cleaned ? 2 : 1) ||
    subtitle.path !==
      `/data/${input.libraryKind}/.media-control/rollback/${row.importOperationId}` ||
    subtitle.qualityStatus !== scope.old.qualityStatus ||
    snapshotHash(z.json().parse(subtitle.provenance)) !==
      snapshotHash(scope.old.provenance)
  )
    throw new Error("Native replaced subtitle archive binding changed");
}

function replacementArtifacts({
  input,
  row,
  scope,
  receipt,
}: ReplacementInput) {
  const format = z
    .enum(["srt", "ass", "ssa", "vtt"])
    .parse(path.extname(scope.destination).slice(1));
  const root = `/data/${input.libraryKind}/.media-control`;
  const relative = {
    source: `subtitles/replacement-${row.id}.${format}`,
    staged: `staging/${row.importOperationId}`,
    partial: `staging/${row.importOperationId}.partial`,
    oldArchive: `rollback/${row.importOperationId}`,
    rejected: `rollback/${row.rollbackOperationId}`,
    rollbackStaged: `staging/${row.rollbackOperationId}`,
  };
  if (new Set(receipt.artifacts.map((item) => item.name)).size !== 6)
    throw new Error("Native replacement artifacts are incomplete");
  const archive = receipt.artifacts.find((item) => item.name === "oldArchive");
  const source = receipt.artifacts.find((item) => item.name === "source");
  if (
    archive?.identity?.checksum !== scope.old.checksum ||
    source?.identity?.checksum !== scope.candidate.checksum ||
    (receipt.archivePath !== path.join(root, relative.oldArchive) &&
      receipt.archivePath !== archive.path) ||
    archive.path !==
      path.join(path.dirname(path.dirname(archive.path)), relative.oldArchive)
  )
    throw new Error("Native replacement artifact receipt changed");
  const recordedRoot = path.dirname(path.dirname(archive.path));
  const files = receipt.artifacts.map((item) => {
    if (item.path !== path.join(recordedRoot, relative[item.name]))
      throw new Error("Native replacement artifact path changed");
    return {
      canonicalPath: path.join(root, relative[item.name]),
      expectedChecksum:
        row.cleanupState === "cleaned"
          ? null
          : (item.identity?.checksum ?? null),
    };
  });
  const journals: NativeTerminalDescriptor["journals"] = [
    {
      operationId: row.importOperationId,
      kind: "import",
      source: source.path,
      target: input.canonicalPath,
      sha256: z.string().parse(scope.candidate.checksum),
      previousSha256: scope.old.checksum,
    },
  ];
  if (row.cleanupState === "cleaned")
    journals.push({
      operationId: `subclean-${row.id}-oldArchive`,
      kind: "purge",
      source: path.join(root, relative.oldArchive),
      target: path.join(root, relative.oldArchive),
      sha256: z.string().parse(scope.old.checksum),
      previousSha256: null,
    });
  return { files, journals };
}

function receiptArtifactIdentities(
  evidence: unknown,
  receipt: z.infer<typeof Receipt>,
  artifacts: ReturnType<typeof replacementArtifacts>,
) {
  const artifactIdentities = [];
  const raw = z
    .object({
      artifacts: z.array(
        z.object({
          path: z.string(),
          identity:
            PublicationSubtitleLineageSchema.shape.artifactIdentities.element.shape.identity.nullable(),
        }),
      ),
    })
    .parse(evidence);
  for (const item of raw.artifacts) {
    if (item.identity === null) continue;
    const artifactIndex = receipt.artifacts.findIndex(
      (artifact) => artifact.path === item.path,
    );
    const file = artifacts.files[artifactIndex];
    if (file?.expectedChecksum !== item.identity.checksum)
      throw new Error("Native replacement artifact identity is unbound");
    artifactIdentities.push({
      canonicalPath: file.canonicalPath,
      identity: item.identity,
    });
  }

  return artifactIdentities;
}
