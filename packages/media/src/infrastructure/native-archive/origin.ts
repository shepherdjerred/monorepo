import type { ArchiveReadOptions } from "./receipt-projection.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  NativeArchiveScopeSchema,
  type NativeArchiveFile,
  type NativeArchiveEdge,
} from "#shared/native-recovery/archive.ts";
import { resolvePriorNativeBinding } from "./prior-binding.ts";
import { NativeArchiveScopeProtection } from "./errors.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { ArchiveReceiptProjection } from "./receipt-projection.ts";

/** Version changes after the committed import require exact immutable archive grants. */
export async function assertArchiveOrigin(
  tx: Prisma.TransactionClient,
  file: NativeArchiveFile,
  edge: NativeArchiveEdge,
  {
    budget = new PublicationAuthorityReadBudget(),
    projection = new ArchiveReceiptProjection(tx, budget),
  }: ArchiveReadOptions = {},
) {
  let cursor = file;
  for (
    let depth = 0;
    cursor.assetVersion > edge.derivedPlan.assetVersion;
    depth++
  ) {
    if (depth >= 100)
      throw new NativeArchiveScopeProtection(
        "Archive original binding chain exceeds bound",
      );
    const reference = await resolvePriorNativeBinding(
      tx,
      cursor,
      cursor.ownershipEpoch,
      { budget, projection },
    );
    if (reference.receiptLifecycle !== "superseded_archive")
      throw new NativeArchiveScopeProtection(
        "Archive transition has no original archive grant",
      );
    const receipt = await projection.read(tx, reference.receiptId, budget);
    const scope = NativeArchiveScopeSchema.parse(receipt.plan.scope);
    const before = scope.files.find((item) => item.assetId === file.assetId);
    if (before?.assetVersion !== cursor.assetVersion - 1)
      throw new Error("Archive original grant omitted predecessor");
    cursor = before;
  }
  if (
    cursor.assetVersion !== edge.derivedPlan.assetVersion ||
    cursor.ownershipEpoch !== edge.recoveryEpoch
  )
    throw new NativeArchiveScopeProtection(
      "Archive version or epoch does not reach original committed publication",
    );
  const sidecars = cursor.subtitles.filter(
    (item) => item.storageKind === "sidecar",
  );
  if (sidecars.length !== edge.publicationAttempt.entry.previousSidecars.length)
    throw new NativeArchiveScopeProtection(
      "Archive original sidecar coverage changed",
    );
  for (const original of edge.publicationAttempt.entry.previousSidecars) {
    const subtitle = sidecars.find((item) => item.id === original.subtitleId);
    if (
      subtitle?.checksum !== original.checksum ||
      subtitle.path !==
        `/data/${edge.derivedPlan.libraryKind}/.media-control/quarantine/${original.quarantineId}`
    )
      throw new NativeArchiveScopeProtection(
        "Archive original sidecar identity changed",
      );
  }
}
