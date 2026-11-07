import nodePath from "node:path";
import type { Transaction, FilePlanEntry } from "#automation/files/types.ts";
import { FileGuardError } from "#automation/files/types.ts";
import type { PublicationContext } from "#automation/publication-proof/invocation.ts";
import { planEmbeddedStreamFacts } from "#automation/files/subtitle-lifecycle/embedded-facts.ts";
import { publicationSubtitleSnapshot } from "#infrastructure/publication-proof/snapshots.ts";

/** New IDs use CREATE, never an empty upsert which could acknowledge a foreign pre-existing row. */
export async function writeSeriesPackEmbeddedV1(
  tx: Transaction,
  context: PublicationContext,
  entry: FilePlanEntry,
  epoch: number,
) {
  const facts = planEmbeddedStreamFacts(entry);
  const acknowledgements = [];
  for (const subtitle of entry.embeddedSubtitles) {
    const observed = facts?.streams.find(
      (row) => row.subtitleId === subtitle.id,
    );
    const prepared = context.preparedEmbedded?.get(subtitle.id);
    const path = nodePath.join(
      context.roots[entry.libraryKind].control,
      subtitle.relativePath,
    );
    if (
      prepared?.path !== path ||
      prepared.checksum !== subtitle.checksum ||
      context.contentProof === undefined ||
      (await context.contentProof.digest(path)) !== subtitle.checksum
    )
      throw new FileGuardError("embedded_content_changed");
    const row = await tx.subtitleAsset.create({
      data: {
        id: subtitle.id,
        assetId: entry.assetId,
        language: subtitle.language,
        providerId: "embedded",
        state: "validated",
        qualityStatus: "accepted",
        storageKind: "sidecar",
        ownershipEpoch: epoch,
        checksum: subtitle.checksum,
        videoChecksum: entry.checksum,
        videoVersion: 0,
        content: new Uint8Array(prepared.bytes),
        ...(observed === undefined
          ? {}
          : {
              forced: observed.forced,
              hearingImpaired: observed.hearingImpaired,
            }),
        provenance: {
          filename: `embedded.${subtitle.format}`,
          description: "Embedded text track from the exact imported video",
          format: subtitle.format,
          streamIndex: subtitle.streamIndex,
          checksum: subtitle.checksum,
        },
        matchingEvidence: {
          ...(facts === undefined || observed === undefined
            ? {}
            : {
                embeddedSourceV2: {
                  schemaVersion: 2,
                  probeHash: facts.probeHash,
                  streamIndex: observed.streamIndex,
                },
              }),
          assetVersion: 0,
          assetChecksum: entry.checksum,
          exactMediaMatch: true,
          videoVersionMatch: true,
          recoveryEpoch: epoch,
          generations: entry.generations,
        },
      },
    });
    acknowledgements.push(publicationSubtitleSnapshot(row));
  }
  return acknowledgements;
}
