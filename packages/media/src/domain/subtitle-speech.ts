import { z } from "zod";
import {
  SubtitleMatchScoreV1Schema,
  subtitleScorePercent,
} from "#shared/subtitle-maintenance/score.ts";

export const SubtitleSpeechProofSchema = z.strictObject({
  schemaVersion: z.literal(1),
  detector: z.literal("ffsubsync-0.5.1/webrtc"),
  videoChecksum: z.string().regex(/^[a-f0-9]{64}$/u),
  subtitleChecksum: z.string().regex(/^[a-f0-9]{64}$/u),
  runtimeMs: z.int().positive().max(28_800_000),
  speechMs: z.int().positive(),
  coveredSpeechMs: z.int().nonnegative(),
  windows: z
    .array(
      z.strictObject({
        speechMs: z.int().nonnegative(),
        coveredSpeechMs: z.int().nonnegative(),
      }),
    )
    .length(12),
});
export type SubtitleSpeechProof = z.infer<typeof SubtitleSpeechProofSchema>;

export function needsRegularDialogueProof(
  evidence: Record<string, unknown>,
  videoChecksum: string | null,
  subtitleChecksum: string | null,
) {
  return (
    evidence["regularDialogueRequiredV1"] === true &&
    !regularDialogueCovered(
      evidence["regularDialogueV1"],
      videoChecksum,
      subtitleChecksum,
    )
  );
}

export function needsSubtitleTimingV1(
  evidence: Record<string, unknown>,
  videoChecksum: string | null,
  subtitleChecksum: string | null,
) {
  if (evidence["matchScoreV1"] === undefined) return false;
  const score = SubtitleMatchScoreV1Schema.parse(evidence["matchScoreV1"]);
  const aligned = z
    .object({
      schemaVersion: z.literal(1),
      videoChecksum: z.literal(videoChecksum),
      subtitleChecksum: z.literal(subtitleChecksum),
    })
    .safeParse(evidence["timingAlignedV1"]);
  return (
    !aligned.success &&
    subtitleScorePercent(score) < (score.kind === "episode" ? 96 : 86)
  );
}

/** Independent audio speech coverage, never a forced flag or human-authorship assertion. */
export function regularDialogueCovered(
  value: unknown,
  videoChecksum: string | null,
  subtitleChecksum: string | null,
): boolean {
  const parsed = SubtitleSpeechProofSchema.safeParse(value);
  if (!parsed.success) return false;
  const p = parsed.data;
  return (
    p.videoChecksum === videoChecksum &&
    p.subtitleChecksum === subtitleChecksum &&
    p.speechMs >= Math.min(30_000, p.runtimeMs / 4) &&
    p.speechMs <= p.runtimeMs &&
    p.coveredSpeechMs <= p.speechMs &&
    p.coveredSpeechMs / p.speechMs >= 0.9 &&
    p.windows.reduce((n, w) => n + w.speechMs, 0) === p.speechMs &&
    p.windows.reduce((n, w) => n + w.coveredSpeechMs, 0) ===
      p.coveredSpeechMs &&
    p.windows.every(
      (w) =>
        w.coveredSpeechMs <= w.speechMs &&
        (w.speechMs < 1000 || w.coveredSpeechMs / w.speechMs >= 0.7),
    )
  );
}
