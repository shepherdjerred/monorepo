import { patched } from "@temporalio/workflow";
import type {
  MediaFileActivities,
  MediaNetworkActivities,
} from "@shepherdjerred/media/automation";
export type SubtitleInput = Parameters<
  MediaNetworkActivities["findMediaSubtitles"]
>[0];

/** Retained histories keep their original command sequence and activity deadlines. */
export async function prepareAndInstallSubtitle(
  input: { operationId: string; subtitleId: string },
  files: Pick<
    MediaFileActivities,
    "prepareSubtitleSpeechV1" | "installMediaSubtitles"
  >,
) {
  if (patched("media-subtitle-speech-v1")) {
    const prepared = await files.prepareSubtitleSpeechV1(input);
    if (prepared.status !== "prepared")
      return {
        status: "blocked" as const,
        reason: prepared.reason ?? "subtitle_speech_protected",
      };
  }
  return files.installMediaSubtitles(input);
}
