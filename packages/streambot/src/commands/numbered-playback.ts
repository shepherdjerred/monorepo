import { PlaybackCommandBoundaryError } from "@shepherdjerred/streambot/commands/playback-command-errors.ts";
import {
  NUMBERED_CHANNEL_HINT,
  playbackTransport,
  type PlaybackChannelNumber,
} from "@shepherdjerred/streambot/types/playback-channel.ts";
import type { MediaMode } from "@shepherdjerred/streambot/sources/media-kind.ts";

export function numberedPlaybackError(
  number: PlaybackChannelNumber | undefined,
  requested: MediaMode | undefined,
  sports = false,
): string | null {
  if (number === undefined) return null;
  if (sports && number === 1)
    return `Sports need a video channel. ${NUMBERED_CHANNEL_HINT}`;
  return requested !== undefined &&
    requested !== "auto" &&
    requested !== playbackTransport(number)
    ? `The selected channel determines audio or video. ${NUMBERED_CHANNEL_HINT}`
    : null;
}
export function assertNumberedPlayback(
  number: PlaybackChannelNumber | undefined,
  requested: MediaMode | undefined,
  sports: boolean,
): void {
  const error = numberedPlaybackError(number, requested, sports);
  if (error !== null) throw new PlaybackCommandBoundaryError(error);
}
