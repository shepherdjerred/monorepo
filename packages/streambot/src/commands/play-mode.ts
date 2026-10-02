import {
  inferMediaIntent,
  type MediaIntent,
} from "@shepherdjerred/streambot/discovery/media-intent.ts";
import type { MediaMode } from "@shepherdjerred/streambot/sources/media-kind.ts";
type PlayModeInput = {
  readonly mode?: MediaMode;
  readonly spoken?: boolean;
  readonly utterance?: string;
};
export function requestedPlayMode(
  input: PlayModeInput,
  intent: MediaIntent,
  query: string,
): MediaMode | undefined {
  const spokenVerbMode =
    input.spoken === true
      ? inferMediaIntent({ query: input.utterance ?? query }).mode
      : undefined;
  if (spokenVerbMode !== undefined) {
    return spokenVerbMode;
  }
  const unspecified = input.mode === undefined || input.mode === "auto";
  const modelVideo = input.spoken === true && input.mode === "video";
  return unspecified || modelVideo ? intent.mode : input.mode;
}
