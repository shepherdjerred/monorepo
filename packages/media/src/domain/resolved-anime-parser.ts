import type { ResolvedProfile } from "./resolved-contract.ts";

/** Captured Sonarr 4.0.20 grammar. Absolute numbering still requires an explicit canonical mapping. */
export function parseResolvedAnime(profile: ResolvedProfile, title: string) {
  if (profile.source !== "sonarr" || title.length > 4096) return null;
  const releaseTitle = title.replace(/\.mkv$/iu, "");
  const prefix =
    /^\[(?<group>[A-Za-z0-9-]{1,64})\] [A-Za-z0-9][A-Za-z0-9 .'-]{0,200}(?: - \d{1,4}(?<revision>v2)?| S\d{2}E\d{2}) (?<details>.+)$/u.exec(
      releaseTitle,
    );
  if (prefix?.groups === undefined) return null;
  const description = animeDescription(prefix.groups["details"] ?? "");
  if (description === null) return null;
  const definitions = profile.qualityDefinitions.filter(
    (definition) =>
      definition.quality.resolution === description.resolution &&
      definition.quality.source.toLowerCase() === description.source,
  );
  const quality = definitions[0];
  if (quality === undefined || definitions.length !== 1) return null;
  return {
    qualityId: quality.quality.id,
    releaseTitle,
    releaseGroup: prefix.groups["group"] ?? null,
    revision: { version: prefix.groups["revision"] === "v2" ? 2 : 1, real: 0 },
    reasons: [],
  };
}
function animeDescription(details: string) {
  const minimal =
    /^(?:\((?<round>720|1080)p\) \[[A-Fa-f0-9]{8}\]|\[(?<square>720|1080)p\]\[Multiple Subtitle\]\[[A-Fa-f0-9]{8}\])$/u.exec(
      details,
    );
  const explicit =
    /^\[(?<resolution>720|1080|2160)p (?<source>WEB-DL|BluRay) (?:H264|x264|x265)(?: 10bit)? (?:AAC|FLAC)(?: Japanese| English| Dual Audio)?\] \[[A-Fa-f0-9]{8}\]$/u.exec(
      details,
    );
  if (minimal === null && explicit === null) return null;
  const resolution = Number(
    minimal?.groups?.["round"] ??
      minimal?.groups?.["square"] ??
      explicit?.groups?.["resolution"],
  );
  // Source compatibility: Sonarr labels resolution-only anime HDTV; this does not claim measured provenance.
  const source =
    minimal === null
      ? explicit?.groups?.["source"] === "WEB-DL"
        ? "web"
        : "bluray"
      : "television";
  return { resolution, source };
}
