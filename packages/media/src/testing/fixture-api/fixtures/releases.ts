import type { z } from "zod";
import type { ReleaseListSchema } from "#shared/api.ts";
import type { MediaItem } from "#shared/contract.ts";
import { HOUR, ago, derivedId } from "#testing/fixture-api/support.ts";
import type { ResolvedMedia } from "./titles.ts";

type ReleaseList = z.input<typeof ReleaseListSchema>;
type Release = ReleaseList[number];

function releaseTag(item: MediaItem): string {
  const season = `S${String(item.seasonNumber ?? 0).padStart(2, "0")}`;
  switch (item.kind) {
    case "movie":
      return "";
    case "series":
      return ".S02";
    case "season":
      return `.${season}`;
    case "episode":
      return `.${season}E${String(item.episodeNumber ?? 0).padStart(2, "0")}`;
  }
}

type ReleaseSeed = {
  suffix: string;
  providerId: string;
  attributes?: Partial<Release["attributes"]>;
  evaluation?: Partial<Release["evaluation"]>;
};

/** One accepted release per tier, then one per rejection reason. */
const RELEASE_SEEDS: readonly ReleaseSeed[] = [
  {
    suffix: "2160p.UHD.BluRay.REMUX.DV.HDR.HEVC.TrueHD.7.1.Atmos-FraMeSToR",
    providerId: "privatehd",
    attributes: {
      quality: "Remux-2160p",
      codec: "hevc",
      sizeBytes: 71_342_556_160,
      scoreTags: ["remux-tier-01", "dv-hdr10", "truehd-atmos"],
    },
    evaluation: { qualityRank: 12, score: 4200 },
  },
  { suffix: "1080p.AMZN.WEB-DL.DDP5.1.H.264-FLUX", providerId: "avistaz" },
  {
    suffix: "2160p.WEB-DL.DDP5.1.Atmos.DV.HEVC-NTb",
    providerId: "knaben",
    attributes: {
      quality: "WEBDL-2160p",
      codec: "hevc",
      sizeBytes: 24_159_191_040,
      identityConfidence: "ambiguous",
      scoreTags: ["web-tier-01", "dv"],
    },
    evaluation: {
      accepted: false,
      qualityRank: 10,
      score: 2900,
      reasons: ["identity_unconfirmed", "coverage_unspecified"],
    },
  },
  {
    suffix: "720p.HDTV.x264-GROUP",
    providerId: "thepiratebay",
    attributes: {
      quality: "HDTV-720p",
      sizeBytes: 1_288_490_188,
      scoreTags: [],
      videoCompatibility: "unknown",
    },
    evaluation: {
      accepted: false,
      qualityRank: 2,
      score: -400,
      reasons: ["quality_rejected", "score_below_minimum"],
    },
  },
  {
    suffix: "1080p.BluRay.x265.10bit.AAC-RARBG",
    providerId: "magnetdownload",
    attributes: {
      quality: "Bluray-1080p",
      codec: "hevc",
      audioLanguages: ["ru"],
      sizeBytes: 3_435_973_836,
      scoreTags: ["x265-hd"],
      videoCompatibility: "incompatible",
    },
    evaluation: {
      accepted: false,
      qualityRank: 7,
      score: 300,
      reasons: ["codec_rejected", "audio_language_missing", "size_rejected"],
    },
  },
  {
    suffix: "CAM.x264-NOGRP",
    providerId: "knaben",
    attributes: {
      quality: "CAM",
      identityConfidence: "mismatch",
      sizeBytes: 0,
      scoreTags: ["lq"],
    },
    evaluation: {
      accepted: false,
      qualityRank: 0,
      score: -10_000,
      reasons: ["identity_unconfirmed", "quality_rejected", "size_unknown"],
    },
  },
];

/** Candidate releases an owner can pick from for one media item. */
export function releaseList(resolved: ResolvedMedia): ReleaseList {
  const { item, title } = resolved;
  const base = `${title.title.replaceAll(/[^A-Za-z0-9]+/gu, ".")}.${String(title.year)}${releaseTag(item)}`;
  return RELEASE_SEEDS.map((seed, index) => ({
    id: derivedId(22, item.id, index + 1),
    providerId: seed.providerId,
    title: `${base}.${seed.suffix}`,
    attributes: {
      mediaIds: [item.id],
      identityConfidence: "exact",
      quality: "WEBDL-1080p",
      codec: "h264",
      audioLanguages: ["en"],
      videoCompatibility: "compatible",
      sizeBytes: 8_214_663_168,
      scoreTags: ["web-tier-01", "dd-plus"],
      ...seed.attributes,
    },
    evaluation: {
      accepted: true,
      qualityRank: 6,
      score: 1750,
      reasons: [],
      ...seed.evaluation,
    },
    createdAt: ago((index + 1) * 7 * HOUR),
  }));
}
