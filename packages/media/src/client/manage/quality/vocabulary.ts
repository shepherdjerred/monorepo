/**
 * The words Media reads out of a release's name (`domain/release-parser.ts`),
 * offered as suggestions when a profile is edited. A profile may hold any
 * text, because profiles captured from Radarr or Sonarr use those
 * applications' own names; these are only the ones a hand-written profile
 * can ever match. `vocabulary.test.ts` parses a release name for each one.
 */

type Suggestion = { value: string; label?: string; group?: string };

const SOURCES = ["Remux", "Bluray", "WEB", "WEBrip", "HDTV"] as const;
const RESOLUTIONS = ["2160", "1080", "720", "576", "480"] as const;

/** Best first, the way the list of qualities reads. */
export const QUALITY_SUGGESTIONS: readonly Suggestion[] = RESOLUTIONS.flatMap(
  (resolution) =>
    SOURCES.map((source) => ({
      value: `${source}-${resolution}p`,
      group: `${resolution}p`,
    })),
);

export const CODEC_SUGGESTIONS: readonly Suggestion[] = [
  { value: "HEVC", label: "HEVC (H.265)" },
  { value: "H264", label: "H264 (AVC)" },
  { value: "AV1" },
  { value: "unknown", label: "unknown (none named in the title)" },
];

export const LANGUAGE_SUGGESTIONS: readonly Suggestion[] = [
  { value: "en", label: "en (English)" },
  { value: "ja", label: "ja (Japanese)" },
  { value: "zh", label: "zh (Chinese)" },
  { value: "ko", label: "ko (Korean)" },
];

/** Traits a release can be scored on. `group:NAME` scores a release group. */
export const TRAITS = [
  "HDR",
  "HDR10+",
  "DV",
  "DD+ATMOS",
  "TrueHD",
  "DTS-X",
  "REPACK",
  "PROPER",
] as const;
