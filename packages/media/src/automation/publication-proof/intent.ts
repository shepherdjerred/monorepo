import type { AcquisitionAttempt } from "#generated/prisma/client.ts";
import {
  FileGuardError,
  type FilePlanEntry,
  type Transaction,
} from "#automation/files/types.ts";
import { snapshotPublicationAsset } from "#infrastructure/publication-proof/snapshots.ts";
import { findPublicationOriginalGrant } from "#infrastructure/publication-proof/grants.ts";
import {
  nativeAttempt,
  nativeJson,
} from "#infrastructure/native-recovery/snapshots.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { PublicationIntentSchema } from "#shared/publication-proof/intent.ts";
import { durablePublicationJournal } from "#filesystem/publication-proof/journal.ts";
import { safePath, exists } from "#filesystem/operations-io.ts";
import { observePublicationParticipants } from "./participants.ts";
import type { PublicationParticipant } from "#shared/publication-proof/intent.ts";
import path from "node:path";
import type { PublicationContext } from "./invocation.ts";
import { publicationSubtitleEvidence } from "./subtitle-lineage.ts";

/** Called under complete DB and real path locks before any forward publication primitive. */
export async function capturePublicationIntent(
  tx: Transaction,
  input: {
    context: PublicationContext;
    attempt: AcquisitionAttempt;
    plan: readonly FilePlanEntry[];
    transitionId: string;
    rawFilePlanHash: string;
  },
) {
  if (
    snapshotHash(nativeJson(input.attempt.filePlan)) !== input.rawFilePlanHash
  )
    throw new FileGuardError("publication_plan_changed");
  const entries = [];
  for (const entry of input.plan)
    entries.push(await captureEntry(tx, input.context, entry));
  return PublicationIntentSchema.parse({
    schemaVersion: 1,
    transitionId: input.transitionId,
    attemptId: input.attempt.id,
    operationId: input.attempt.operationId,
    birthEpoch: input.attempt.recoveryEpoch,
    filePlanHash: input.rawFilePlanHash,
    attemptSnapshotHash: snapshotHash(nativeAttempt(input.attempt)),
    mediaIds: input.attempt.mediaIds,
    entries,
  });
}

async function captureEntry(
  tx: Transaction,
  context: PublicationContext,
  entry: FilePlanEntry,
) {
  const roots = context.roots[entry.libraryKind];
  const predecessor =
    entry.previousAssetId === null
      ? null
      : await snapshotPublicationAsset(tx, entry.previousAssetId);
  const participants = await observePublicationParticipants(context, entry);
  assertInitialParticipants(entry, participants);
  for (const id of [
    `recover-${entry.assetId}`,
    ...entry.previousSidecars.map((sidecar) => sidecar.operationId),
  ]) {
    if (
      await exists(await safePath(roots.control, `journal/${id}.json`, false))
    )
      throw new FileGuardError("publication_effect_without_intent");
  }
  const journal = await durablePublicationJournal(roots, {
    version: 1,
    operationId: entry.operationId,
    kind: "import",
    source: path.join(roots.downloads, entry.downloadPath),
    target: path.join(roots.library, entry.libraryPath),
    sha256: entry.checksum,
    previousSha256: entry.previousChecksum,
    phase: "staged",
  });
  const originalGrant =
    predecessor === null
      ? null
      : await findPublicationOriginalGrant(tx, {
          asset: predecessor,
          libraryKind: entry.libraryKind,
        });
  const lineage = originalGrant?.subtitleLineage;
  const prepared =
    predecessor === null
      ? undefined
      : context.preparedSubtitleLineages?.get(predecessor.id);
  if (
    lineage === undefined
      ? prepared !== undefined
      : prepared === undefined ||
        snapshotHash(nativeJson(prepared.lineage)) !==
          snapshotHash(nativeJson(lineage))
  )
    throw new FileGuardError("publication_subtitle_lineage_changed");
  const subtitleEvidence =
    prepared === undefined
      ? undefined
      : await publicationSubtitleEvidence(
          context,
          requireContent(context),
          prepared,
        );
  return {
    entry,
    entryHash: snapshotHash(nativeJson(entry)),
    predecessor,
    originalGrant,
    participants,
    journals: [journal],
    ...(subtitleEvidence === undefined ? {} : { subtitleEvidence }),
  };
}

function requireContent(context: PublicationContext) {
  if (context.contentProof === undefined)
    throw new Error("Publication subtitle lineage content proof missing");
  return context.contentProof;
}

function assertInitialParticipants(
  entry: FilePlanEntry,
  participants: readonly PublicationParticipant[],
) {
  for (const participant of participants) {
    const physical = participant.physical;
    const expected = initialDigest(entry, participant);
    if (
      expected === null
        ? physical.state !== "absent"
        : physical.state !== "present" || physical.sha256 !== expected
    )
      throw new FileGuardError("publication_effect_without_intent");
    if (
      participant.role === "staging" &&
      participant.assetId === entry.assetId &&
      physical.state === "present" &&
      physical.sizeBytes !== entry.sizeBytes
    )
      throw new FileGuardError("publication_content_changed");
  }
}

function initialDigest(
  entry: FilePlanEntry,
  participant: PublicationParticipant,
): string | null {
  if (participant.role === "video") return entry.previousChecksum;
  if (
    participant.role === "staging" &&
    participant.physical.path === `staging/${entry.operationId}`
  )
    return entry.checksum;
  if (participant.role === "sidecar") {
    const sidecar = entry.previousSidecars.find(
      (item) => item.subtitleId === participant.subtitleId,
    );
    if (sidecar === undefined)
      throw new Error("Publication sidecar descriptor missing");
    return sidecar.checksum;
  }
  if (participant.role === "extracted") {
    const subtitle = entry.embeddedSubtitles.find(
      (item) => item.id === participant.subtitleId,
    );
    if (subtitle === undefined)
      throw new Error("Publication extracted descriptor missing");
    return subtitle.checksum;
  }
  return null;
}
