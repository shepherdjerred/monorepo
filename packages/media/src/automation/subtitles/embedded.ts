import { z } from "zod";
import {
  embeddedStreamFacts,
  EmbeddedStreamSourceV2Schema,
} from "#shared/subtitles/stream-facts.ts";

/** A staged extraction is reusable only against its recorded probe and exact video. */
export function reusableEmbeddedSubtitle(
  subtitle: {
    id: string;
    providerId: string;
    checksum: string | null;
    language: string;
    forced: boolean | null;
    hearingImpaired: boolean | null;
    matchingEvidence: unknown;
  },
  asset: { id: string; checksum: string | null; properties: unknown },
): boolean {
  const evidence = z
    .object({ embeddedSourceV2: EmbeddedStreamSourceV2Schema.optional() })
    .parse(subtitle.matchingEvidence);
  if (evidence.embeddedSourceV2 === undefined) return false;
  const facts = embeddedStreamFacts(asset.properties);
  const source = evidence.embeddedSourceV2;
  const observed = facts?.streams.find((row) => row.subtitleId === subtitle.id);
  if (
    facts === undefined ||
    observed === undefined ||
    subtitle.providerId !== "embedded" ||
    facts.assetId !== asset.id ||
    facts.videoChecksum !== asset.checksum ||
    facts.probeHash !== source.probeHash ||
    observed.streamIndex !== source.streamIndex ||
    observed.checksum !== subtitle.checksum ||
    observed.language !== subtitle.language ||
    observed.forced !== subtitle.forced ||
    observed.hearingImpaired !== subtitle.hearingImpaired
  )
    throw new Error("Embedded subtitle differs from its actual extraction");
  return true;
}
