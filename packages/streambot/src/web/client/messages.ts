import { z } from "zod";
import {
  WebApiErrorCodeSchema,
  type WebApiErrorCode,
} from "@shepherdjerred/streambot/web/shared/error-codes.ts";
import type { ApiFailure } from "./api.ts";

/** What an error state says, and whether trying the same thing again can help. */
export type FailureCopy = { readonly text: string; readonly retry: boolean };

/**
 * The server's own message names the specific cause (which feature is off, which search source
 * failed, which playlist name is taken), so the page shows it; `retry` says whether trying again
 * can help.
 */
type ServerWorded = { readonly server: true; readonly retry: boolean };

const SERVER: ServerWorded = { server: true, retry: false };
const SERVER_RETRYABLE: ServerWorded = { server: true, retry: true };

const TOO_MANY: FailureCopy = {
  text: "Too many requests at once. Wait a moment, then try again.",
  retry: true,
};
const SIGNED_OUT: FailureCopy = {
  text: "Your sign-in expired. Reload the page to sign in again.",
  retry: false,
};

/**
 * Every code the web API can answer with gets either its own sentence or an explicit choice to
 * show the server's message. The type requires an entry per code in the shared list, so a code
 * added on the server fails the client's type check until it is worded here.
 */
export const API_WORDING: Readonly<
  Record<WebApiErrorCode, FailureCopy | ServerWorded>
> = {
  album_edition: SERVER,
  album_required: SERVER,
  artwork_unavailable: SERVER,
  busy: {
    text: "Streambot is busy right now. Wait a moment, then try again.",
    retry: true,
  },
  catalog_busy: SERVER_RETRYABLE,
  catalog_unavailable: SERVER_RETRYABLE,
  channel_changed: {
    text: "You moved to another voice channel. Try again to use the new one.",
    retry: true,
  },
  channels_unavailable: {
    text: "Separate Listen and Watch streams are unavailable while an older shared queue is playing.",
    retry: false,
  },
  csrf: SIGNED_OUT,
  discord_unavailable: SERVER_RETRYABLE,
  event_ended: SERVER,
  feature_disabled: SERVER,
  guild_changed: SERVER,
  guild_denied: SERVER,
  guild_required: SERVER,
  history_disabled: SERVER,
  history_unavailable: SERVER_RETRYABLE,
  invalid_channel: {
    text: "That stream is no longer available. Reload the page and try again.",
    retry: false,
  },
  invalid_request: SERVER,
  item_finished: {
    text: "That item already finished. The player shows what is on now.",
    retry: false,
  },
  join_voice: SERVER,
  library_changed: SERVER,
  listen_disabled: {
    text: "Listening in the voice channel is off in this server. Use Watch instead.",
    retry: false,
  },
  listen_sports: {
    text: "Live games can only be watched, not listened to.",
    retry: false,
  },
  load_missing: SERVER,
  lol_disabled: SERVER,
  method: SERVER,
  music_disabled: SERVER,
  music_query: SERVER,
  music_search_unavailable: SERVER_RETRYABLE,
  no_session: { text: "Nothing is playing there any more.", retry: false },
  no_station: { text: "That station already stopped.", retry: false },
  no_video: {
    text: "This has no video to stream. Use Listen instead.",
    retry: false,
  },
  not_found: SERVER,
  not_upcoming: SERVER,
  oauth_state: SIGNED_OUT,
  playback_changed: {
    text: "The queue changed before this applied. Check the queue, then try again.",
    retry: true,
  },
  playback_channel_changed: SERVER,
  playback_denied: SERVER,
  playlist_busy: SERVER_RETRYABLE,
  playlist_changed: {
    text: "This playlist changed since you opened it. Refresh it, then try again.",
    retry: false,
  },
  playlist_empty: SERVER,
  playlist_import_link: SERVER,
  playlist_missing: SERVER,
  playlist_name: SERVER,
  playlist_owner: SERVER,
  queue_empty: SERVER,
  rate_limit: TOO_MANY,
  requester_changed: SERVER,
  requester_required: SERVER,
  room_stream_capacity: TOO_MANY,
  room_stream_limit: TOO_MANY,
  scheduling_unavailable: SERVER_RETRYABLE,
  selection_capacity: SERVER,
  selection_expired: {
    text: "These results expired. Search again to play this.",
    retry: false,
  },
  selection_invalid: SERVER,
  sign_in: SIGNED_OUT,
  sports_disabled: SERVER,
  sports_pro_only: SERVER,
  sports_unavailable: SERVER_RETRYABLE,
  sports_upcoming: SERVER,
  spotify_audio: SERVER,
  spotify_link: SERVER,
  spotify_metadata: SERVER_RETRYABLE,
  spotify_unavailable: SERVER_RETRYABLE,
  station_unavailable: SERVER_RETRYABLE,
  stream_limit: {
    text: "Streambot cannot start another stream in this server right now.",
    retry: true,
  },
  subtitle_audio: SERVER,
  subtitle_picker_busy: SERVER_RETRYABLE,
  subtitles_unavailable: SERVER,
  track_changed: SERVER,
  track_required: SERVER,
  unauthorized: SIGNED_OUT,
  unavailable: {
    text: "Streambot could not finish this. Try again in a moment.",
    retry: true,
  },
};

/** Failures the page detects itself, before or instead of a server answer. */
const ClientCodeSchema = z.enum(["no_voice", "network", "bad_response"]);

export const CLIENT_WORDING: Readonly<
  Record<z.infer<typeof ClientCodeSchema>, FailureCopy>
> = {
  no_voice: { text: "Join a voice channel in Discord to play.", retry: false },
  network: {
    text: "Streambot could not be reached. Check your connection, then try again.",
    retry: true,
  },
  bad_response: {
    text: "Streambot answered in a way this page does not understand. Reload the page.",
    retry: false,
  },
};

/** The words for one failure. Every code gets a specific sentence; none is a bare status. */
export function describeFailure(failure: ApiFailure): FailureCopy {
  const client = ClientCodeSchema.safeParse(failure.code);
  if (client.success) return CLIENT_WORDING[client.data];
  const code = WebApiErrorCodeSchema.safeParse(failure.code);
  // A code this build does not know (the wire is a plain string) gets the generic wording.
  if (!code.success) return fallback(failure);
  const wording = API_WORDING[code.data];
  if (!("server" in wording)) return wording;
  return failure.message === ""
    ? fallback(failure)
    : { text: failure.message, retry: wording.retry };
}

function fallback(failure: ApiFailure): FailureCopy {
  if (failure.status === 429) return TOO_MANY;
  return {
    text:
      failure.message === ""
        ? "Streambot could not finish this."
        : failure.message,
    retry: failure.status === 0 || failure.status >= 500,
  };
}
