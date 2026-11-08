import { createHash } from "node:crypto";
import type { Prisma } from "#generated/prisma/client.ts";
import type {
  MovieRollbackIntentV1,
  MovieRollbackPhysicalV1,
} from "#shared/movie-editions/rollback/physical.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { advanceSubtitleBindings } from "#automation/files/subtitle-lifecycle/ownership.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { ManifestSchema } from "#filesystem/operations-types.ts";

/** Only this new manual protocol advances B-owned captions. Independent old
 * replacement archives remain literal and never become the inverse baseline. */
export async function retainRequestedMovieRollbackCaptionsV1(
  tx: Prisma.TransactionClient,
  intent: MovieRollbackIntentV1,
) {
  const manifest = intent.captionManifest;
  if (manifest === undefined || intent.invocation.mode !== "manual_verified")
    throw new FileGuardError("movie_rollback_manual_caption_manifest_missing");
  for (const caption of manifest.captions)
    await tx.subtitleAsset.update({
      where: {
        id: caption.snapshot.id,
        version: caption.snapshot.version,
        state: "installed",
      },
      data: { path: caption.storedTargetPath },
    });
  await advanceSubtitleBindings(tx, {
    assetId: intent.successor.id,
    checksum: intent.successor.checksum,
    epoch: intent.authority.recoveryEpoch,
    fromVersion: intent.successor.version,
    toVersion: intent.successor.version + 1,
    fromState: "installed",
    sidecarIds: manifest.captions.map((caption) => caption.snapshot.id),
    state: "quarantined",
  });
}

/** Complete retained caption metadata and every real primitive descriptor are
 * bound to the actual admitted B, separately from original A's inverse chain. */
export function assertRequestedMovieRollbackCaptionsV1(
  intent: MovieRollbackIntentV1,
  receipt: MovieRollbackPhysicalV1,
) {
  const manifest = intent.captionManifest,
    completed = receipt.successorCaptions;
  if (
    manifest === undefined ||
    completed === undefined ||
    receipt.playback === undefined ||
    completed.manifestHash !== identityHash(manifest)
  )
    throw new Error(
      "Manual movie rollback lost its actual caption or playback closure",
    );
  const before = intent.successor;
  const after = new Map(
    [...receipt.successor.subtitles, ...receipt.successor.subtitleHistory].map(
      (row) => [row.id, row],
    ),
  );
  if (after.size !== before.subtitles.length + before.subtitleHistory.length)
    throw new Error(
      "Manual movie rollback changed complete successor caption inventory",
    );
  for (const caption of before.subtitleHistory)
    if (identityHash(after.get(caption.id)) !== identityHash(caption))
      throw new Error(
        "Manual movie rollback changed independent successor caption history",
      );
  for (const caption of before.subtitles) {
    const sidecar = manifest.captions.find(
      (row) => row.snapshot.id === caption.id,
    );
    if (
      caption.state !== "installed" ||
      (sidecar === undefined && caption.storageKind === "sidecar") ||
      identityHash(after.get(caption.id)) !==
        identityHash({
          ...caption,
          version: caption.version + 1,
          state: "quarantined",
          videoVersion: before.version + 1,
          path: sidecar === undefined ? caption.path : sidecar.storedTargetPath,
        })
    )
      throw new Error(
        "Manual movie rollback lost its exact owned successor caption transition",
      );
  }
  if (
    completed.effects.length !== manifest.captions.length * 3 ||
    completed.targets.length !== manifest.captions.length ||
    completed.closedSources.length !== manifest.captions.length ||
    completed.journals.length !== manifest.captions.length
  )
    throw new Error("Manual movie rollback caption chain is incomplete");
  manifest.captions.forEach((caption, index) => {
    assertCaptionClosure(caption, index, intent, receipt);
  });
}

function assertCaptionClosure(
  caption: NonNullable<
    MovieRollbackIntentV1["captionManifest"]
  >["captions"][number],
  index: number,
  intent: MovieRollbackIntentV1,
  receipt: MovieRollbackPhysicalV1,
) {
  const completed = receipt.successorCaptions;
  if (completed === undefined)
    throw new Error("Manual caption closure disappeared");
  const expectedSteps = ["move_link", "move_unlink", "journal_complete"];
  const target = completed.targets[index];
  const source = completed.closedSources[index];
  const journal = completed.journals[index];
  if (
    journal === undefined ||
    source === undefined ||
    target === undefined ||
    expectedSteps.some((step, offset) => {
      const effect = completed.effects[index * 3 + offset];
      return (
        effect?.ordinal !== index * 3 + offset ||
        effect.operationId !== caption.operationId ||
        effect.libraryKind !== "movies" ||
        effect.step !== step
      );
    })
  )
    throw new Error(
      "Manual movie rollback caption effect or journal inventory changed",
    );
  assertCaptionTarget(caption, intent, target);
  if (
    source.subtitleId !== caption.snapshot.id ||
    source.physical.root !== "library" ||
    source.physical.path !== caption.source.path
  )
    throw new Error("Manual movie rollback caption source path changed");
  const restored = receipt.participants.find(
    (participant) =>
      participant.physical.root === "library" &&
      participant.physical.path === caption.source.path,
  );
  if (
    restored === undefined
      ? source.physical.state !== "absent"
      : identityHash(restored.physical) !== identityHash(source.physical)
  )
    throw new Error(
      "Manual movie rollback caption source lacks its truthful final original-inverse state",
    );
  assertCaptionJournal(caption, journal);
}

type Caption = NonNullable<
  MovieRollbackIntentV1["captionManifest"]
>["captions"][number];
type Outcome = NonNullable<MovieRollbackPhysicalV1["successorCaptions"]>;

function assertCaptionTarget(
  caption: Caption,
  intent: MovieRollbackIntentV1,
  target: Outcome["targets"][number],
) {
  if (
    target.subtitleId !== caption.snapshot.id ||
    target.assetId !== intent.successor.id ||
    target.libraryKind !== "movies" ||
    target.role !== "quarantine" ||
    target.physical.state !== "present" ||
    target.physical.root !== "control" ||
    target.physical.path !== caption.target.path ||
    target.physical.sha256 !== caption.source.sha256 ||
    target.physical.sizeBytes !== caption.source.sizeBytes ||
    target.physical.identity.device !== caption.source.identity.device ||
    target.physical.identity.inode !== caption.source.identity.inode
  )
    throw new Error(
      "Manual movie rollback retained caption lost its complete real effect chain or original inode",
    );
}

function assertCaptionJournal(
  caption: Caption,
  journal: Outcome["journals"][number],
) {
  const descriptor = ManifestSchema.parse(JSON.parse(journal.raw));
  if (
    journal.path !== `journal/${caption.operationId}.json` ||
    descriptor.operationId !== caption.operationId ||
    descriptor.kind !== "quarantine" ||
    descriptor.phase !== "complete" ||
    descriptor.sha256 !== caption.snapshot.checksum ||
    descriptor.previousSha256 !== null ||
    descriptor.source !== caption.workerSourcePath ||
    descriptor.target !== caption.workerTargetPath ||
    createHash("sha256").update(journal.raw).digest("hex") !== journal.sha256 ||
    Buffer.byteLength(journal.raw).toString() !== journal.sizeBytes
  )
    throw new Error(
      "Manual movie rollback caption journal lost its actual quarantine descriptor",
    );
}
