import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  BundleReportSchema,
  MigrationSelectionSchema,
} from "#shared/migration-handoff.ts";
import { MigrationBundleProtocolSchema } from "#shared/handoff/library-bundle.ts";
import {
  PassiveRegistrationApprovalSchema,
  type PassiveRegistrationPreviewInputSchema,
} from "#shared/handoff/passive-registration.ts";
import { ExternalLibraryRegistrationSchema } from "#shared/external-library/contract.ts";
import { canonicalJson, snapshotHash } from "#migration/profile-import.ts";
import { projectHandoffFile } from "#infrastructure/handoff/scope.ts";
import { validatePassiveRegistration } from "#infrastructure/handoff/passive-registration.ts";

/** Read-only producer for explicit owner approvals, using the same source/path
 * projection that preparation later rechecks under physical ownership locks. */
export async function previewPassiveRegistrations(
  tx: Prisma.TransactionClient,
  input: z.infer<typeof PassiveRegistrationPreviewInputSchema>,
) {
  const review = await tx.migrationBundleReview.findUniqueOrThrow({
    where: { id: input.bundleReviewId },
    include: { bundle: true },
  });
  const manifest = MigrationBundleProtocolSchema.parse(review.bundle.manifest);
  const report = BundleReportSchema.parse(review.report);
  if (
    review.status !== "approved" ||
    review.version !== input.bundleReviewVersion ||
    review.reportHash !== report.reportHash ||
    !report.complete ||
    !report.stable ||
    !manifest.complete ||
    !manifest.stable ||
    report.bundleHash !== manifest.bundleHash
  )
    throw new Error(
      "Passive registration preview requires the unchanged approved complete bundle",
    );
  const approved = MigrationSelectionSchema.parse(review.selection);
  const entries = report.entries.filter((entry) =>
    input.selected.includes(entry.provenanceKey),
  );
  if (
    entries.length !== input.selected.length ||
    entries.some(
      (entry) =>
        entry.sourceRecord.kind !== "file" ||
        entry.confidence !== "exact" ||
        snapshotHash(z.json().parse(entry.sourceRecord)) !==
          entry.observationHash ||
        !approved.some(
          (item) =>
            item.provenanceKey === entry.provenanceKey &&
            item.evidenceHash === entry.observationHash,
        ),
    )
  )
    throw new Error("Passive preview requires exact selected file evidence");
  const media = await tx.mediaItem.findMany({
    where: {
      id: { in: [...new Set(entries.flatMap((entry) => entry.mediaIds))] },
    },
    select: { id: true, kind: true },
  });
  const approvals = [];
  for (const entry of entries) {
    const file = await projectHandoffFile(tx, entry, manifest, media);
    if (file.existingAssetId === null) continue;
    const asset = await tx.libraryAsset.findUniqueOrThrow({
      where: { id: file.existingAssetId },
      include: { coverage: true },
    });
    const registration = z
      .object({ externalLibrary: ExternalLibraryRegistrationSchema })
      .parse(asset.properties).externalLibrary;
    const event = await tx.applicationEvent.findUniqueOrThrow({
      where: { id: registration.registrationEventId },
    });
    const approval = PassiveRegistrationApprovalSchema.parse({
      provenanceKey: file.provenanceKey,
      assetId: asset.id,
      expectedVersion: 0,
      registrationEventId: event.id,
      registrationHash: snapshotHash(registration),
      registrationRaw: canonicalJson(registration),
    });
    validatePassiveRegistration({ approval, asset, event, file });
    approvals.push(approval);
  }
  return approvals;
}
