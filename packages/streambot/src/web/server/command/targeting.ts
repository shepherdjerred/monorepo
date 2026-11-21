import {
  AUDIO_CHANNEL,
  PlaybackChannelNumberSchema,
  VIDEO_CHANNEL,
  type PlaybackChannelNumber,
} from "@shepherdjerred/streambot/types/playback-channel.ts";
import type {
  WebCommand,
  WebTransport,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";
import {
  WebError,
  requestInput,
} from "@shepherdjerred/streambot/web/server/errors.ts";

/**
 * Actions whose arguments name queue positions or a subtitle track of one item. They stay bound to
 * the revision the viewer saw; every other action applies to the current state.
 */
const POSITIONAL_ACTIONS: ReadonlySet<WebCommand["action"]> = new Set([
  "remove",
  "move",
  "subtitles",
]);

export function isPositional(input: WebCommand): boolean {
  return POSITIONAL_ACTIONS.has(input.action);
}

/** The item token a transport control was aimed at, when the client sent one. */
export function expectedCurrent(input: WebCommand): string | undefined {
  return input.action === "pause" ||
    input.action === "resume" ||
    input.action === "skip" ||
    input.action === "seek"
    ? input.expectCurrent
    : undefined;
}

function transportOf(input: WebCommand): WebTransport | undefined {
  return input.action === "play" ? input.transport : undefined;
}

/**
 * The slot a command targets. `numbered` is false while a legacy queue holds the room or
 * numbered channels are off; that room has one mixed queue, so Listen and Watch become the item's
 * mode there and only a named extra slot is refused.
 */
export function targetPlaybackChannel(
  input: WebCommand,
  numbered: boolean,
  maximum: () => number,
): PlaybackChannelNumber | undefined {
  const transport = transportOf(input);
  if (!numbered) {
    assertLegacyChannel(transport, input.playbackChannel);
    return;
  }
  if (transport === "listen") return listenChannel(input.playbackChannel);
  const requested = input.playbackChannel;
  if (requested === null) {
    const implicit = implicitChannel(input);
    if (implicit !== undefined) return implicit;
    throw new WebError(400, "invalid_channel", "Choose a Streambot channel.");
  }
  const slot = requestInput(PlaybackChannelNumberSchema, requested);
  if (transport === "watch") return watchChannel(slot, maximum);
  if (slot > maximum())
    throw new WebError(
      400,
      "invalid_channel",
      "That Streambot channel is unavailable.",
    );
  return slot;
}

/**
 * The slot a command without a slot lands on: Watch and TV on the first video slot, Radio
 * on the audio slot. Stopping a station and every player control name the card they came from.
 */
function implicitChannel(input: WebCommand): PlaybackChannelNumber | undefined {
  if (input.action === "play" && input.transport === "watch")
    return VIDEO_CHANNEL;
  if (input.action !== "station" || input.mode === "off") return;
  return input.mode === "tv" ? VIDEO_CHANNEL : AUDIO_CHANNEL;
}

/** A legacy room has one queue, so only "no slot" or the transport's usual slot can name it. */
function assertLegacyChannel(
  transport: WebTransport | undefined,
  requested: number | null,
): void {
  const defaultSlot =
    transport === "listen"
      ? AUDIO_CHANNEL
      : transport === "watch"
        ? VIDEO_CHANNEL
        : null;
  if (requested === null || requested === defaultSlot) return;
  throw new WebError(
    409,
    "channels_unavailable",
    "Separate Streambot streams are unavailable while a legacy queue is active or numbered channels are off.",
  );
}

function listenChannel(requested: number | null): PlaybackChannelNumber {
  if (requested !== null && requested !== AUDIO_CHANNEL)
    throw new WebError(
      400,
      "invalid_channel",
      "Listen always plays on Streambot channel 1.",
    );
  return AUDIO_CHANNEL;
}

function watchChannel(
  slot: PlaybackChannelNumber,
  maximum: () => number,
): PlaybackChannelNumber {
  if (slot === AUDIO_CHANNEL)
    throw new WebError(
      400,
      "invalid_channel",
      "Watch plays on Streambot channel 2 or higher.",
    );
  if (slot > maximum())
    throw new WebError(
      409,
      "stream_limit",
      "Streambot cannot start another stream in this server right now.",
    );
  return slot;
}
