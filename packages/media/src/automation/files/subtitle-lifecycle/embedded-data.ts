import type { FilePlanEntry } from "#automation/files/types.ts";
import type { planEmbeddedStreamFacts } from "./embedded-facts.ts";

type StreamFacts = NonNullable<ReturnType<typeof planEmbeddedStreamFacts>>;
type ObservedStream = StreamFacts["streams"][number];

export function embeddedSubtitleFields(input: {
  entry: FilePlanEntry;
  subtitle: FilePlanEntry["embeddedSubtitles"][number];
  epoch: number;
  bytes: Uint8Array;
  observed: ObservedStream | undefined;
}) {
  const { entry, subtitle, epoch, bytes, observed } = input;
  return {
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
    content: new Uint8Array(bytes),
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
  };
}

export function embeddedProbeEvidence(
  facts: StreamFacts | undefined,
  observed: ObservedStream | undefined,
) {
  return facts === undefined || observed === undefined
    ? {}
    : {
        embeddedSourceV2: {
          schemaVersion: 2,
          probeHash: facts.probeHash,
          streamIndex: observed.streamIndex,
        },
      };
}
