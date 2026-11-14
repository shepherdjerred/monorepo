import { createHash } from "node:crypto";
import {
  parseReleaseName,
  normalizeMediaTitle,
} from "#domain/release-parser.ts";
import {
  SubtitleMatchScoreV1Schema,
  SubtitleScoreReferenceV1Schema,
  SUBTITLE_MATCH_WEIGHTS_V1,
  SubtitleCatalogEvidenceV1Schema,
  type SubtitleCatalogEvidenceV1,
  type SubtitleScoreReferenceV1,
  type SubtitleMatchKeyV1,
} from "#shared/subtitle-maintenance/score.ts";

function stem(value: string) {
  return value
    .replace(/\.(?:mkv|mp4|avi|m4v|srt|ass|ssa|vtt)$/iu, "")
    .replace(
      /[. _-](?:en|eng|zh[._-]?(?:cn|hans)|chs)(?:[. _-](?:forced|sdh|hi))*$/iu,
      "",
    );
}
function group(value: string) {
  return /-([a-z0-9]+)$/iu.exec(stem(value))?.[1]?.toLowerCase() ?? null;
}
function service(value: string) {
  return (
    /(?:^|[. _-])(AMZN|ATVP|DSNP|HMAX|HBO|NF|PCOK|HULU|MAX)(?:[. _-]|$)/iu
      .exec(value)?.[1]
      ?.toLowerCase() ?? null
  );
}
function source(value: string) {
  return value.replace(/-(?:480|576|720|1080|2160)p$/u, "").toLowerCase();
}
function codec(value: string) {
  return value
    .toLowerCase()
    .replace(/^(?:h264|avc|x264)$/u, "h264")
    .replace(/^(?:h265|hevc|x265)$/u, "hevc");
}

/** Real observed matches use the audited Bazarr weight catalog. Missing fields
 * earn no points; filename equality is never a fabricated perfect score. */
export function subtitleScoreReferenceHashV1(raw: SubtitleScoreReferenceV1) {
  return createHash("sha256")
    .update(JSON.stringify(SubtitleScoreReferenceV1Schema.parse(raw)))
    .digest("hex");
}
function catalogStatus(
  reference: SubtitleScoreReferenceV1,
  raw: SubtitleCatalogEvidenceV1 | undefined,
): "confirmed" | "conflict" | "unconfirmed" {
  if (raw === undefined) return "unconfirmed";
  const observed = SubtitleCatalogEvidenceV1Schema.parse(raw);
  if (observed.kind !== (reference.kind === "movie" ? "movie" : "series"))
    return "conflict";
  const matches = new Set([
    reference.imdbId === null || observed.imdbId === null
      ? null
      : BigInt(reference.imdbId.slice(2)) === BigInt(observed.imdbId.slice(2)),
    reference.tmdbId === null || observed.tmdbId === null
      ? null
      : reference.tmdbId === observed.tmdbId,
  ]);
  return matches.has(false)
    ? "conflict"
    : matches.has(true)
      ? "confirmed"
      : "unconfirmed";
}
type ScoreSource = {
  filename: string;
  hearingImpaired: boolean | null;
  catalogEvidenceV1?: SubtitleCatalogEvidenceV1;
};
function catalogMatches(
  reference: SubtitleScoreReferenceV1,
  subtitle: ScoreSource,
  identity: ReturnType<typeof catalogStatus>,
) {
  const observed = parseReleaseName(stem(subtitle.filename));
  const matches: SubtitleMatchKeyV1[] = [];
  if (
    identity === "confirmed" ||
    normalizeMediaTitle(reference.title) === observed.title
  )
    matches.push(reference.kind === "movie" ? "title" : "series");
  if (
    identity === "confirmed" ||
    (reference.year !== null && reference.year === observed.year)
  )
    matches.push("year");
  if (reference.kind === "episode") {
    if (
      reference.season !== null &&
      reference.season ===
        (subtitle.catalogEvidenceV1?.season ?? observed.season)
    )
      matches.push("season");
    if (
      reference.episode !== null &&
      (subtitle.catalogEvidenceV1?.episode === reference.episode ||
        (observed.episodes.length === 1 &&
          observed.episodes[0] === reference.episode))
    )
      matches.push("episode");
  }
  return matches;
}
function technicalMatches(
  reference: SubtitleScoreReferenceV1,
  subtitle: ScoreSource,
) {
  const observed = parseReleaseName(stem(subtitle.filename));
  const matches: SubtitleMatchKeyV1[] = [];
  if (
    reference.quality !== null &&
    source(observed.quality) !== "unknown" &&
    source(reference.quality) === source(observed.quality)
  )
    matches.push("source");
  if (
    reference.quality !== null &&
    /-(\d+)p$/u.exec(reference.quality)?.[1] ===
      /-(\d+)p$/u.exec(observed.quality)?.[1] &&
    /-\d+p$/u.test(observed.quality)
  )
    matches.push("resolution");
  if (
    reference.videoCodec !== null &&
    observed.codec !== "unknown" &&
    codec(reference.videoCodec) === codec(observed.codec)
  )
    matches.push("video_codec");
  if (
    group(reference.sourceFilename) !== null &&
    group(reference.sourceFilename) === group(subtitle.filename)
  )
    matches.push("release_group");
  if (
    service(reference.sourceFilename) !== null &&
    service(reference.sourceFilename) === service(subtitle.filename)
  )
    matches.push("streaming_service");
  if (subtitle.hearingImpaired === false) matches.push("hearing_impaired");
  return matches;
}
export function subtitleSourceScoreV1(
  raw: SubtitleScoreReferenceV1,
  subtitle: ScoreSource,
) {
  const reference = SubtitleScoreReferenceV1Schema.parse(raw);
  const identity = catalogStatus(reference, subtitle.catalogEvidenceV1);
  const matches = [
    ...catalogMatches(reference, subtitle, identity),
    ...technicalMatches(reference, subtitle),
  ];
  // Neither absent edition tags nor absent audio-codec/hash metadata are proof.
  const score = matches.reduce(
    (sum, key) => sum + (SUBTITLE_MATCH_WEIGHTS_V1[reference.kind][key] ?? 0),
    0,
  );
  return SubtitleMatchScoreV1Schema.parse({
    schemaVersion: 1,
    weights: "bazarr-1.6.2",
    matcher: "media-evidence-v1",
    kind: reference.kind,
    score,
    maximum: reference.kind === "episode" ? 360 : 180,
    matches,
    catalogStatus: identity,
    referenceHash: subtitleScoreReferenceHashV1(reference),
  });
}
