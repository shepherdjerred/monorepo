import type { z } from "zod";
import type { SubtitleSourceProfileSchema } from "#shared/migration-subtitles.ts";
import { SubtitlePolicySchema } from "#shared/subtitle-policy.ts";
import {
  subtitleAccepted,
  type SubtitleQuality,
  type SubtitleVideo,
} from "./subtitle-quality.ts";
type Source = z.infer<typeof SubtitleSourceProfileSchema>;
function itemProtection(
  item: Source["items"][number],
  chinese: "unresolved" | "require_simplified",
) {
  if (
    item.language !== "en" &&
    !(chinese === "require_simplified" && item.language === "zh")
  )
    return item.language === "zh"
      ? "chinese_script_choice_required"
      : "subtitle_language_unsupported";
  if (item.audio_exclude === "True" && item.audio_only_include === "True")
    return "subtitle_audio_policy_conflict";
  return item.forced === "True" && item.hi === "Excluded"
    ? "forced_hi_exclusion_source_semantics_require_resolution"
    : null;
}
function translateItem(item: Source["items"][number]) {
  return {
    sourceItemId: item.id,
    language: item.language === "en" ? "en" : "zh-Hans",
    audioLanguage: item.language,
    forced: item.forced === "True",
    hearingImpaired:
      item.hi === "True"
        ? "required"
        : item.hi === "Excluded" || item.forced === "True"
          ? "excluded"
          : "any",
    audio:
      item.audio_exclude === "True"
        ? "exclude_matching"
        : item.audio_only_include === "True"
          ? "only_matching"
          : "any",
  };
}

/** Bazarr v1.6.2 indexer/movies.py: normal HI=False accepts HI; forced remains a distinct exact target. */
export function translateSubtitlePolicy(
  source: z.infer<typeof SubtitleSourceProfileSchema>,
  chinese: "unresolved" | "require_simplified",
) {
  const reasons: string[] = [];
  if (source.cutoff !== null)
    reasons.push("subtitle_cutoff_requires_resolution");
  if (source.hasConstraints)
    reasons.push("subtitle_text_constraints_require_resolution");
  if (source.originalFormat === true || source.originalFormat === 1)
    reasons.push("subtitle_original_format_requires_resolution");
  const targets = [];
  for (const item of source.items) {
    const protection = itemProtection(item, chinese);
    if (protection === null) targets.push(translateItem(item));
    else reasons.push(protection);
  }
  return SubtitlePolicySchema.parse({
    schemaVersion: 1,
    targets,
    protectedReasons: [...new Set(reasons)],
  });
}

export function subtitlePolicySatisfaction(input: {
  rules: z.infer<typeof SubtitlePolicySchema>;
  subtitles: readonly SubtitleQuality[];
  asset: SubtitleVideo;
  epoch: number;
  audioLanguages: readonly string[] | null;
}) {
  const reasons = [...input.rules.protectedReasons];
  const missing = input.rules.targets.filter((target) => {
    if (target.audio !== "any" && input.audioLanguages === null) {
      reasons.push("subtitle_audio_evidence_unknown");
      return true;
    }
    const matches =
      input.audioLanguages?.includes(target.audioLanguage) === true;
    if (
      (matches && target.audio === "exclude_matching") ||
      (!matches && target.audio === "only_matching")
    )
      return false;
    return !input.subtitles.some((subtitle) =>
      subtitleAccepted({
        subtitle,
        asset: input.asset,
        epoch: input.epoch,
        target,
      }),
    );
  });
  return {
    satisfied: reasons.length === 0 && missing.length === 0,
    missing,
    protectedReasons: [...new Set(reasons)],
  };
}
