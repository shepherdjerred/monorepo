import type { MediaProbe } from "#filesystem/media-tools.ts";
import type { FilePlanEntry } from "#automation/files/types.ts";
import {
  EmbeddedStreamFactsV2Schema,
  embeddedStreamFacts,
} from "#shared/subtitles/stream-facts.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";

/** New observations bind actual ffprobe flags to the exact normalized extraction and physical video. */
export function captureEmbeddedStreamFacts(input: {
  assetId: string;
  checksum: string;
  probe: MediaProbe;
  subtitles: FilePlanEntry["embeddedSubtitles"];
}) {
  return EmbeddedStreamFactsV2Schema.parse({
    schemaVersion: 2,
    assetId: input.assetId,
    videoChecksum: input.checksum,
    probeHash: snapshotHash(nativeJson(input.probe)),
    streams: input.subtitles.map((subtitle) => {
      const stream = input.probe.streams.find(
        (row) => row.index === subtitle.streamIndex,
      );
      if (stream?.codec_type !== "subtitle")
        throw new Error("Extracted subtitle lost its actual probed stream");
      return {
        subtitleId: subtitle.id,
        checksum: subtitle.checksum,
        language: subtitle.language,
        streamIndex: stream.index,
        forced:
          stream.disposition === undefined
            ? null
            : stream.disposition.forced === 1,
        hearingImpaired:
          stream.disposition === undefined
            ? null
            : stream.disposition.hearing_impaired === 1,
      };
    }),
  });
}

export function planEmbeddedStreamFacts(entry: FilePlanEntry) {
  const facts = embeddedStreamFacts(entry.properties);
  if (facts === undefined) return;
  if (
    facts.assetId !== entry.assetId ||
    facts.videoChecksum !== entry.checksum ||
    facts.streams.length !== entry.embeddedSubtitles.length ||
    facts.streams.some(
      (row) =>
        !entry.embeddedSubtitles.some(
          (subtitle) =>
            subtitle.id === row.subtitleId &&
            subtitle.streamIndex === row.streamIndex &&
            subtitle.checksum === row.checksum &&
            subtitle.language === row.language,
        ),
    )
  )
    throw new Error(
      "Embedded observations differ from the exact captured file plan",
    );
  return facts;
}
