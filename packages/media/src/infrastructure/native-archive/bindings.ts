import { z } from "zod";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  NativeArchiveBindingSchema,
  type NativeArchiveContinuation,
  type NativeArchiveFile,
} from "#shared/native-recovery/archive.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { archiveClosure } from "./closure.ts";
import { archiveTerminalDependency } from "./terminal.ts";
import { assertArchiveAuthority } from "./authority.ts";
import { PublicationAuthorityReferenceSchema } from "#shared/publication-proof/references.ts";
import { nativePhysicalIdentity } from "./physical-identity.ts";
import { snapshotArchiveSubtitles } from "#automation/native-archive/subtitles.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

export async function resolveArchiveBindings(
  tx: Prisma.TransactionClient,
  receipt: Prisma.NativeRecoveryReceiptGetPayload<object>,
  descriptor: NativeArchiveContinuation,
  budget = new PublicationAuthorityReadBudget(),
) {
  budget.consume(1);
  const selection = z
    .object({
      bindings: z.array(NativeArchiveBindingSchema),
      reusedBindings: z.array(PublicationAuthorityReferenceSchema),
    })
    .parse(receipt.selection);
  if (
    snapshotHash(selection.bindings) !== snapshotHash(descriptor.bindings) ||
    snapshotHash(nativeJson(selection.reusedBindings)) !==
      snapshotHash(nativeJson(descriptor.reusedBindings))
  )
    throw new Error("Archive continuation grant selection changed");
  const closure = await archiveClosure(tx, descriptor.scope.request.cleanupIds);
  const files: NativeArchiveFile[] = [];
  const bindings = [];
  const terminalDependencies = [...descriptor.scope.terminalDependencies];
  for (const file of descriptor.scope.files) {
    const actual = closure.assets.find((row) => row.id === file.assetId);
    if (actual === undefined)
      throw new Error(
        "Archive closure changed; publication transition reconciliation required",
      );
    if (actual.state === "purged") {
      if (file.role === "current_playback")
        throw new Error("Archive current playback was purged");
      const cleanup = closure.cleanups.find(
        (row) => row.assetId === file.assetId,
      );
      if (cleanup === undefined)
        throw new Error("Archive terminal pair missing");
      terminalDependencies.push(
        await archiveTerminalDependency(tx, cleanup, closure.assets, budget),
      );
      continue;
    }
    const { reference, current } = effectiveGrant(receipt, descriptor, file);
    const verified = await assertArchiveAuthority(
      tx,
      current,
      reference,
      budget,
    );
    await assertCurrentFile(tx, actual, current);
    files.push({ ...current, authority: reference });
    bindings.push(verified);
  }
  if (
    closure.assets.some(
      (asset) =>
        !descriptor.scope.files.some((file) => file.assetId === asset.id) &&
        !descriptor.scope.terminalDependencies.some((item) =>
          item.dependency.assetIds.includes(asset.id),
        ),
    )
  )
    throw new Error(
      "Archive successor transition requires reviewed reconciliation",
    );
  return {
    bindings,
    terminalDependencies,
    networkScope: { ...descriptor.scope, files, terminalDependencies },
  };
}
function effectiveGrant(
  receipt: Prisma.NativeRecoveryReceiptGetPayload<object>,
  descriptor: NativeArchiveContinuation,
  file: NativeArchiveFile,
) {
  let reference = descriptor.reusedBindings.find(
    (row) => row.assetId === file.assetId,
  );
  const binding = descriptor.bindings.find(
    (row) => row.assetId === file.assetId,
  );
  let current = file;
  if (binding !== undefined) {
    if (reference !== undefined)
      throw new Error("Archive grant and reuse overlap");
    current = {
      ...file,
      assetVersion: binding.assetVersion,
      ownershipEpoch: binding.ownershipEpoch,
      subtitles: file.subtitles.map((subtitle) => {
        const transition = binding.subtitles.find(
          (item) => item.id === subtitle.id,
        );
        if (transition === undefined)
          throw new Error("Archive subtitle transition missing");
        return { ...subtitle, ...transition.after };
      }),
    };
    const proof = descriptor.fileEvidence.files.find(
      (item) => item.assetId === file.assetId,
    );
    if (proof === undefined) throw new Error("Archive physical proof missing");
    reference = {
      kind: "prior_native_binding",
      receiptLifecycle: "superseded_archive",
      receiptId: receipt.id,
      planHash: receipt.planHash,
      assetId: file.assetId,
      bindingHash: snapshotHash(binding),
      physicalEvidenceHash: snapshotHash(nativePhysicalIdentity(proof)),
    };
  }
  if (reference === undefined)
    throw new Error("Archive continuation participant lacks effective binding");
  return { reference, current };
}
async function assertCurrentFile(
  tx: Prisma.TransactionClient,
  actual: Awaited<ReturnType<typeof archiveClosure>>["assets"][number],
  current: NativeArchiveFile,
) {
  if (
    actual.version !== current.assetVersion ||
    actual.ownershipEpoch !== current.ownershipEpoch ||
    actual.state !== current.state ||
    actual.path !== current.canonicalPath ||
    actual.checksum !== current.checksum ||
    !actual.owned ||
    actual.edition !== current.edition ||
    actual.editionRootId !== current.editionRootId ||
    actual.sourcePath !== current.sourcePath ||
    actual.supersededByAssetId !== current.supersededByAssetId ||
    actual.sizeBytes.toString() !== current.sizeBytes ||
    snapshotHash([
      actual.plexPublishedAt?.toISOString() ?? null,
      actual.rollbackExpiresAt?.toISOString() ?? null,
    ]) !== snapshotHash([current.plexPublishedAt, current.rollbackExpiresAt]) ||
    snapshotHash(z.json().parse(actual.properties)) !==
      snapshotHash(current.properties) ||
    snapshotHash(
      actual.coverage.map(({ mediaId, edition, current: covered }) => ({
        mediaId,
        edition,
        current: covered,
      })),
    ) !== snapshotHash(current.coverage)
  )
    throw new Error("Archive effective physical binding changed");
  if (
    snapshotHash(await snapshotArchiveSubtitles(tx, current.assetId)) !==
    snapshotHash(current.subtitles)
  )
    throw new Error("Archive effective subtitle binding changed");
}
