/** Unknown policy/evidence and transient failures never become a bad-release judgment. */
export function definitiveMeasuredRejection(
  reasons: readonly string[],
  audioLanguages: readonly string[],
  codec = "H264",
): boolean {
  const measured = new Set([
    "quality_rejected",
    "size_rejected",
    "resolved_quality_rejected",
    "resolved_size_below_minimum",
    "resolved_size_above_maximum",
  ]);
  if (["H264", "HEVC", "AV1"].includes(codec)) measured.add("codec_rejected");
  if (audioLanguages.length > 0) {
    measured.add("audio_language_missing");
    measured.add("resolved_original_audio_missing");
  }
  return reasons.length > 0 && reasons.every((reason) => measured.has(reason));
}
