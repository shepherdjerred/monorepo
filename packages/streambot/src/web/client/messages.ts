import type { ApiFailure } from "./api.ts";

/** What an error state says, and whether trying the same thing again can help. */
export type FailureCopy = { readonly text: string; readonly retry: boolean };

const COPY: Readonly<Record<string, FailureCopy>> = {
  no_voice: {
    text: "Join a voice channel in Discord to play.",
    retry: false,
  },
  item_finished: {
    text: "That item already finished. The player shows what is on now.",
    retry: false,
  },
  no_video: {
    text: "This has no video to stream. Use Listen instead.",
    retry: false,
  },
  listen_disabled: {
    text: "Listening in the voice channel is off in this server. Use Watch instead.",
    retry: false,
  },
  listen_sports: {
    text: "Live games can only be watched, not listened to.",
    retry: false,
  },
  stream_limit: {
    text: "Streambot cannot start another stream in this server right now.",
    retry: true,
  },
  channels_unavailable: {
    text: "Separate Listen and Watch streams are unavailable while an older shared queue is playing.",
    retry: false,
  },
  invalid_channel: {
    text: "That stream is no longer available. Reload the page and try again.",
    retry: false,
  },
  playback_changed: {
    text: "The queue changed before this applied. Check the queue, then try again.",
    retry: true,
  },
  channel_changed: {
    text: "You moved to another voice channel. Try again to use the new one.",
    retry: true,
  },
  no_session: {
    text: "Nothing is playing there any more.",
    retry: false,
  },
  no_station: { text: "That station already stopped.", retry: false },
  playlist_changed: {
    text: "This playlist changed since you opened it. Refresh it, then try again.",
    retry: false,
  },
  selection_expired: {
    text: "These results expired. Search again to play this.",
    retry: false,
  },
  rate_limit: {
    text: "Too many requests at once. Wait a moment, then try again.",
    retry: true,
  },
  busy: {
    text: "Streambot is busy right now. Wait a moment, then try again.",
    retry: true,
  },
  sign_in: {
    text: "Your sign-in expired. Reload the page to sign in again.",
    retry: false,
  },
  network: {
    text: "Streambot could not be reached. Check your connection, then try again.",
    retry: true,
  },
  unavailable: {
    text: "Streambot could not finish this. Try again in a moment.",
    retry: true,
  },
  bad_response: {
    text: "Streambot answered in a way this page does not understand. Reload the page.",
    retry: false,
  },
};

/**
 * Codes whose server message already names the specific cause (which feature is off, which
 * search source failed), so the page shows that message instead of a generic one.
 */
const SERVER_WORDED = new Set([
  "feature_disabled",
  "guild_denied",
  "sports_disabled",
  "history_disabled",
  "music_search_unavailable",
  "not_found",
  "sports_pro_only",
  "sports_upcoming",
  "event_ended",
  "join_voice",
  "subtitles_unavailable",
  "subtitle_picker_busy",
  "playback_denied",
  "invalid_request",
]);

/** The words for one failure. Every code gets a specific sentence; none is a bare status. */
export function describeFailure(failure: ApiFailure): FailureCopy {
  const known = COPY[failure.code];
  if (known !== undefined) return known;
  if (SERVER_WORDED.has(failure.code) && failure.message !== "")
    return {
      text: failure.message,
      retry: failure.status === 503 || failure.status === 429,
    };
  return failure.status === 429
    ? (COPY["rate_limit"] ?? fallback(failure))
    : fallback(failure);
}

function fallback(failure: ApiFailure): FailureCopy {
  return {
    text:
      failure.message === ""
        ? "Streambot could not finish this."
        : failure.message,
    retry: failure.status === 0 || failure.status >= 500,
  };
}
