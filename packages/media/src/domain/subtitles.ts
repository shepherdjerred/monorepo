export type SubtitleEvidence = {
  requestedLanguage: string;
  actualLanguage: string;
  exactMediaMatch: boolean;
  videoVersionMatch: boolean;
  machineLabelled: boolean;
  traditionalOnlyCharacters: number;
  simplifiedOnlyCharacters: number;
  minimumSimplifiedEvidence: number;
};

/** Character evidence must come from complete, pinned OpenCC script tables. */
export function evaluateSubtitle(evidence: SubtitleEvidence): {
  accepted: boolean;
  reasons: string[];
} {
  if (
    ![
      evidence.traditionalOnlyCharacters,
      evidence.simplifiedOnlyCharacters,
      evidence.minimumSimplifiedEvidence,
    ].every((count) => Number.isSafeInteger(count) && count >= 0) ||
    evidence.minimumSimplifiedEvidence <= 0
  ) {
    throw new Error(
      "Subtitle script evidence must contain valid nonnegative counts and a positive threshold",
    );
  }
  const reasons: string[] = [];
  if (!evidence.exactMediaMatch) reasons.push("media_mismatch");
  if (!evidence.videoVersionMatch) reasons.push("video_version_mismatch");
  if (evidence.machineLabelled) reasons.push("machine_translation_label");
  if (evidence.actualLanguage !== evidence.requestedLanguage)
    reasons.push("language_mismatch");
  if (
    evidence.requestedLanguage === "zh-CN" ||
    evidence.requestedLanguage === "zh-Hans"
  ) {
    if (evidence.traditionalOnlyCharacters > 0)
      reasons.push("traditional_script_detected");
    if (evidence.simplifiedOnlyCharacters < evidence.minimumSimplifiedEvidence)
      reasons.push("simplified_evidence_insufficient");
  }
  return { accepted: reasons.length === 0, reasons };
}
