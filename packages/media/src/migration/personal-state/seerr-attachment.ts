import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import type { Prisma, SeerrRequestApproval } from "#generated/prisma/client.ts";
import type { MediaCommandSettings } from "#infrastructure/command-base.ts";
import type { Database } from "#infrastructure/database.ts";
import { runtimeAuthority } from "#infrastructure/handoff/authority.ts";
import { isRetryableTransaction } from "#infrastructure/locks.ts";
import {
  advanceLegacyClaimKnowledge,
  lockLegacyClaimKnowledge,
} from "#infrastructure/recovery/legacy-claims/knowledge-fence.ts";
import { personalSourceSelection } from "#infrastructure/recovery/legacy-claims/personal-accounting.ts";
import { exactPersonalTargets } from "#infrastructure/recovery/legacy-claims/personal-native.ts";
import {
  assessVisibilityAccess,
  visibilityAncestry,
} from "#infrastructure/visibility/access.ts";
import { ImportedPersonalClaimSchema } from "#shared/personal-migration/contract.ts";
import { releasePersonalMigrationHolds } from "./holds.ts";
import {
  ensureSeerrAttachmentBinding,
  isIndependentSeerrAccount,
} from "./seerr-attachment-binding.ts";
import { createImportedSourceClaim } from "./source-claim.ts";

type SourceCommand = NonNullable<
  Awaited<ReturnType<typeof createImportedSourceClaim>>["command"]
>;
type Enqueue = (
  tx: Prisma.TransactionClient,
  command: SourceCommand,
) => Promise<string>;

async function readApproval(
  tx: Prisma.TransactionClient,
  row: SeerrRequestApproval,
) {
  const receipt = await tx.applicationEvent.findUniqueOrThrow({
    where: { id: row.receiptId },
  });
  const stored = await tx.migrationRecord.findUniqueOrThrow({
    where: {
      captureId_provenanceKey: {
        captureId: row.captureId,
        provenanceKey: row.provenanceKey,
      },
    },
    include: { capture: true },
  });
  const selection = personalSourceSelection(receipt.payload, stored);
  if (
    receipt.kind !== "personal_state_imported" ||
    receipt.actorId === null ||
    !stored.capture.complete ||
    !stored.capture.stable ||
    selection?.selected.disposition !== "deferred" ||
    selection.selected.plexAccountId !== row.plexAccountId ||
    selection.record.plexAccountId !== row.plexAccountId ||
    !selection.record.active ||
    (selection.record.sourceStatus !== 2 &&
      selection.record.sourceStatus !== 5) ||
    selection.selected.edition === null ||
    selection.selected.mediaIds.length === 0
  )
    throw new Error("Pending Seerr request does not match its reviewed source");
  return {
    ownerId: receipt.actorId,
    stored,
    ...selection,
    edition: selection.selected.edition,
  };
}

type Attachment = {
  actor: MediaActor;
  key: string;
  settings: MediaCommandSettings;
  enqueue: Enqueue;
};

async function attachApproval(tx: Prisma.TransactionClient, input: Attachment) {
  const { actor, key, settings, enqueue } = input;
  const { user, reader } = await assessVisibilityAccess(tx, actor, settings);
  if (
    reader === null ||
    user.plexAccountId !== actor.plexAccountId ||
    !isIndependentSeerrAccount(user)
  )
    return false;
  // Owner approval and requester-binding changes use this same knowledge fence.
  await lockLegacyClaimKnowledge(tx);
  const row = await tx.seerrRequestApproval.findUnique({
    where: { provenanceKey: key },
  });
  if (row?.pending !== true || row.plexAccountId !== user.plexAccountId)
    return false;
  const { ownerId, stored, selected, record, edition } = await readApproval(
    tx,
    row,
  );
  const targets = await tx.mediaItem.findMany({
    where: { id: { in: selected.mediaIds } },
    include: visibilityAncestry,
  });
  if (
    !exactPersonalTargets(targets, selected.mediaIds, record) ||
    !targets.every((item) => reader.visible(item))
  )
    return false;
  if (record.scope !== "movie") {
    const runtime = await runtimeAuthority(tx);
    if (!runtime.active) return false;
  }
  const binding = await ensureSeerrAttachmentBinding(tx, {
    actorId: ownerId,
    user,
    capture: stored.capture,
    requesterSourceId: record.requesterSourceId,
  });
  if (binding === null) return false;
  await advanceLegacyClaimKnowledge(tx);

  const imports = [];
  for (const mediaId of [...selected.mediaIds].sort()) {
    const result = await createImportedSourceClaim(tx, {
      mediaId,
      userId: user.id,
      edition,
    });
    if (result.command !== null) await enqueue(tx, result.command);
    imports.push(
      ImportedPersonalClaimSchema.parse({
        requestId: result.request.id,
        mediaId,
        userId: user.id,
        edition,
        captureId: selected.captureId,
        provenanceKey: selected.provenanceKey,
        sourceId: selected.sourceId,
        sourceStatus: record.sourceStatus,
        needsAcquisitionChoice: result.needsAcquisitionChoice,
      }),
    );
  }
  const event = await tx.applicationEvent.create({
    data: {
      actorId: user.id,
      kind: "personal_state_imported",
      dedupeKey: `seerr-attachment:${row.receiptId}:${key}`,
      payload: z.record(z.string(), z.json()).parse({
        schemaVersion: 1,
        approvalEventId: row.receiptId,
        captures: [
          {
            id: row.captureId,
            captureHash: stored.capture.manifestHash,
            sourceKind: stored.capture.sourceKind,
          },
        ],
        claims: [
          {
            ...selected,
            disposition: "import",
            reason: null,
            userId: user.id,
            bindingId: binding.id,
            bindingRevision: binding.revision,
          },
        ],
        sourceRecords: [
          {
            captureId: row.captureId,
            provenanceKey: key,
            observationHash: stored.observationHash,
          },
        ],
        imports,
        keepingPolicy: "temporary",
        interestState: "following",
        changesPlaybackState: false,
        transfersTorrentOwnership: false,
      }),
    },
  });
  await tx.seerrRequestApproval.update({
    where: { provenanceKey: key },
    data: { pending: false, attachmentEventId: event.id },
  });
  await releasePersonalMigrationHolds(tx, {
    actorId: ownerId,
    eventId: event.id,
    scopes: imports.map(({ mediaId }) => ({ mediaId, edition })),
  });
  return true;
}

async function attachWithRetry(db: Database, input: Attachment) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await db.$transaction((tx) => attachApproval(tx, input), {
        isolationLevel: "Serializable",
        timeout: 15_000,
      });
    } catch (error) {
      if (error instanceof MediaError && error.code === "runtime_not_active")
        return false;
      if (attempt === 3 || !isRetryableTransaction(error)) throw error;
    }
  }
  throw new Error("Attachment retry bound was not enforced");
}

/** Signed-in requests may arrive concurrently. Each source attaches atomically. */
export async function attachSeerrRequests(
  db: Database,
  actor: MediaActor,
  settings: MediaCommandSettings,
  enqueue: Enqueue,
) {
  if (actor.restricted) return 0;
  const pending = await db.seerrRequestApproval.findMany({
    where: { plexAccountId: actor.plexAccountId, pending: true },
    orderBy: { provenanceKey: "asc" },
    select: { provenanceKey: true },
    take: 1001,
  });
  if (pending.length > 1000)
    throw new Error("Pending Seerr requests exceed the import bound");
  let attached = 0;
  for (const { provenanceKey: key } of pending)
    if (await attachWithRetry(db, { actor, key, settings, enqueue }))
      attached++;
  return attached;
}
