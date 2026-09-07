/**
 * `/stream play`/`playnext` handling — split out of `command-handler.ts` to keep that file under
 * the max-lines cap. Playlist URLs expand and queue synchronously (unchanged); non-playlist
 * url/search sources are resolved via yt-dlp before acking (synchronous pre-validation), so bad
 * input gets a specific error instead of a silent "Queued" — the resolved result is threaded onto
 * the queued item so the machine's `resolving` state reuses it instead of re-fetching.
 */
import type {
  CommandHandlerDeps,
  CommandInteraction,
} from "@shepherdjerred/streambot/discord/command-types.ts";
import {
  classifyPlayError,
  isHttpUrl,
  resolvePlayQuery,
} from "@shepherdjerred/streambot/discord/resolve.ts";
import {
  buildSubtitlePref,
  subtitlesSuffix,
} from "@shepherdjerred/streambot/discord/subtitle-options.ts";
import { randomTip } from "@shepherdjerred/streambot/discord/tips.ts";
import {
  sourceLabel,
  withMode,
  withSubtitles,
  type SubtitlePref,
} from "@shepherdjerred/streambot/sources/source.ts";
import { isLikelyPlaylist } from "@shepherdjerred/streambot/sources/ytdlp.ts";
import {
  MediaModeSchema,
  type MediaMode,
} from "@shepherdjerred/streambot/sources/media-kind.ts";
import {
  BlockedSourceError,
  isBlockedSource,
  shameMessage,
} from "@shepherdjerred/streambot/moderation/adult-block.ts";
import type { ResolvedSource } from "@shepherdjerred/streambot/machine/types.ts";
import type { UserId } from "@shepherdjerred/streambot/types/ids.ts";
import { PlaybackCommandService } from "@shepherdjerred/streambot/commands/playback-command-service.ts";
import { PlaybackCommandBoundaryError } from "@shepherdjerred/streambot/commands/playback-command-errors.ts";
import {
  inferMediaIntent,
  MediaPlacementSchema,
  MediaSourcePreferenceSchema,
  type MediaPlacement,
  type MediaSourcePreference,
} from "@shepherdjerred/streambot/discovery/media-intent.ts";

const PLAYLIST_TIMEOUT_MS = 60_000;
const PLAY_RESOLVE_TIMEOUT_MS = 30_000;

type PlayCommandInput = {
  readonly deps: CommandHandlerDeps;
  readonly interaction: CommandInteraction;
  readonly query: string;
  readonly subtitles: SubtitlePref | undefined;
  readonly next: boolean;
  /** Raw `mode:` option. The feature gate is applied later, per request, not here. */
  readonly mode: MediaMode | undefined;
};

type DiscoveredPlayInput = PlayCommandInput & {
  readonly source: MediaSourcePreference;
  readonly placement: MediaPlacement;
};

function ackMessage(
  label: string,
  next: boolean,
  subtitles: SubtitlePref | undefined,
): string {
  return `${next ? "Up next" : "Queued"}: **${label}**${subtitlesSuffix(subtitles)}\n\nTip: ${randomTip()}`;
}

export async function runPlayCommand(
  deps: CommandHandlerDeps,
  interaction: CommandInteraction,
  next: boolean,
): Promise<void> {
  const query = interaction.getStringRequired("query");
  const subtitles = buildSubtitlePref(
    interaction.getString("subtitles"),
    interaction.getString("sublang"),
  );
  const selectedPlacement = MediaPlacementSchema.parse(
    interaction.getString("placement") ?? (next ? "next" : "queue"),
  );
  const selectedSource = MediaSourcePreferenceSchema.parse(
    interaction.getString("source") ?? "auto",
  );
  const requestedMode = MediaModeSchema.parse(
    interaction.getString("mode") ?? "auto",
  );

  // Subtitles only exist on a picture. `mode:music` plays audio only, `prepareStream` throws if a
  // burn is passed with it, and the music branch drops one silently — so an explicit subtitle
  // request must never be quietly discarded.
  const wantsSubtitles =
    interaction.getString("subtitles") !== null ||
    interaction.getString("sublang") !== null;
  if (requestedMode === "music" && wantsSubtitles) {
    await interaction.reply(
      "`mode:music` plays audio only, so subtitles can't be burned in. Drop the subtitle options, or use `mode:video`.",
    );
    return;
  }
  // With `mode:auto` the classifier would otherwise be free to pick music and drop the subtitle
  // the user explicitly asked for. Asking for subtitles IS asking for a picture, so it settles the
  // transport — and if the item turns out to have no video track, the resolver rejects it by name
  // rather than playing a song with the request silently ignored.
  const effectiveMode =
    requestedMode === "auto" && wantsSubtitles ? "video" : requestedMode;

  if (
    selectedPlacement === "now" &&
    deps.featureGate !== undefined &&
    deps.guildId !== undefined &&
    deps.channelId !== undefined &&
    !(await deps.featureGate.assistantV2({
      guildId: deps.guildId,
      channelId: deps.channelId,
      userId: interaction.userId,
    }))
  ) {
    await interaction.reply("Playing now is not enabled here yet.");
    return;
  }

  if (isHttpUrl(query) && isLikelyPlaylist(query)) {
    await runPlaylistRequest({
      deps,
      interaction,
      query,
      subtitles,
      next,
      mode: effectiveMode,
      source: selectedSource,
      placement: selectedPlacement,
    });
    return;
  }

  if (deps.discovery !== undefined) {
    await runDiscoveredPlay({
      deps,
      interaction,
      query,
      subtitles,
      next,
      mode: effectiveMode,
      source: selectedSource,
      placement: selectedPlacement,
    });
    return;
  }

  await runLegacyPlay({
    deps,
    interaction,
    query,
    subtitles,
    next,
    mode: effectiveMode,
  });
}

async function runPlaylistRequest(input: DiscoveredPlayInput): Promise<void> {
  if (input.source !== "auto" && input.source !== "youtube") {
    await input.interaction.reply(
      "Playlist URLs can only use the auto or YouTube source.",
    );
    return;
  }
  await runPlaylist(input);
}

function playlistItemPlacement(
  index: number,
  placement: MediaPlacement,
  next: boolean,
): MediaPlacement {
  if (index === 0 && placement === "now") return "now";
  if (placement === "next" || next) return "next";
  return "queue";
}

function playlistEventType(
  placement: MediaPlacement,
): "PLAY_NOW" | "ADD_NEXT" | "ADD" {
  if (placement === "now") return "PLAY_NOW";
  if (placement === "next") return "ADD_NEXT";
  return "ADD";
}

async function playlistHistoryEnabled(
  deps: CommandHandlerDeps,
  scope: {
    readonly guildId: string;
    readonly channelId: string;
    readonly userId: string;
  } | null,
): Promise<boolean> {
  if (scope === null || deps.history === undefined) return false;
  return (
    deps.featureGate === undefined || (await deps.featureGate.history(scope))
  );
}

function playlistPlayNowDenial(
  deps: CommandHandlerDeps,
  userId: UserId,
  placement: MediaPlacement,
): string | null {
  if (placement !== "now") return null;
  try {
    new PlaybackCommandService(deps).assertCanPlayNow(userId);
    return null;
  } catch (error) {
    if (error instanceof PlaybackCommandBoundaryError) return error.message;
    throw error;
  }
}

async function runPlaylist(
  input: PlayCommandInput & {
    readonly source: MediaSourcePreference;
    readonly placement: MediaPlacement;
  },
): Promise<void> {
  const { deps, interaction, query, subtitles, next, placement } = input;
  await interaction.defer();
  const initialDenial = playlistPlayNowDenial(
    deps,
    interaction.userId,
    placement,
  );
  if (initialDenial !== null) {
    await interaction.editReply(initialDenial);
    return;
  }
  const items = await deps.expandPlaylist(
    query,
    AbortSignal.timeout(PLAYLIST_TIMEOUT_MS),
  );
  const scope =
    deps.guildId === undefined || deps.channelId === undefined
      ? null
      : {
          guildId: deps.guildId,
          channelId: deps.channelId,
          userId: interaction.userId,
        };
  const history = deps.history;
  const historyEnabled = await playlistHistoryEnabled(deps, scope);
  const dispatchDenial = playlistPlayNowDenial(
    deps,
    interaction.userId,
    placement,
  );
  if (dispatchDenial !== null) {
    await interaction.editReply(dispatchDenial);
    return;
  }
  // One gate evaluation for the whole playlist: every item is queued by the same user in the same
  // scope, so per-item lookups would be identical flag reads at up to `playlistLimit` items.
  const itemMode = await new PlaybackCommandService(deps).resolveMediaMode(
    interaction.userId,
    input.mode,
  );
  const dispatchItems =
    placement === "next" || next ? items.toReversed() : items;
  if (placement === "now" && dispatchItems.length > 0) {
    const currentRequestId = deps.view().current?.requestId;
    if (currentRequestId !== undefined) {
      deps.history?.updateRequest(currentRequestId, "skipped");
    }
  }
  for (const [index, item] of dispatchItems.entries()) {
    const itemPlacement = playlistItemPlacement(index, placement, next);
    const source = withMode(
      { kind: "url", url: item.url, subtitles },
      itemMode,
    );
    const requestId =
      historyEnabled && history !== undefined && scope !== null
        ? history.recordQueueRequest({
            scope,
            rawQuery: item.title,
            intent: inferMediaIntent({
              query: item.title,
              source: "youtube",
              placement: itemPlacement,
            }),
            media: {
              title: item.title,
              provider: "youtube",
              source,
              canonicalUrl: item.url,
            },
          })
        : undefined;
    deps.dispatch({
      type: playlistEventType(itemPlacement),
      source,
      requesterId: interaction.userId,
      ...(requestId === undefined ? {} : { requestId }),
    });
  }
  await interaction.editReply(
    `Queued ${String(items.length)} item(s) from the playlist.${subtitlesSuffix(subtitles)}\n\nTip: ${randomTip()}`,
  );
}

async function runDiscoveredPlay(input: DiscoveredPlayInput): Promise<void> {
  const { deps, interaction, query, subtitles, source, placement, mode } =
    input;
  await interaction.defer();
  try {
    const result = await new PlaybackCommandService(deps).play({
      query,
      source,
      placement,
      userId: interaction.userId,
      spoken: false,
      ...(subtitles === undefined ? {} : { subtitles }),
      ...(mode === undefined ? {} : { mode }),
    });
    await interaction.editReply(`${result.message}\n\nTip: ${randomTip()}`);
  } catch (error) {
    if (error instanceof PlaybackCommandBoundaryError) {
      await interaction.editReply(error.message);
      return;
    }
    throw error;
  }
}

async function runLegacyPlay(input: PlayCommandInput): Promise<void> {
  const { deps, interaction, query, subtitles, next, mode } = input;
  const userId = interaction.userId;

  // The gate lives on the service because that is where `DiscoveryScope` is assembled; this path
  // never calls `play()`, so it asks for the decision explicitly rather than skipping it. Without
  // this, the legacy path would ignore the rollout flag entirely.
  const source = withMode(
    withSubtitles(resolvePlayQuery(query, deps.library()), subtitles),
    await new PlaybackCommandService(deps).resolveMediaMode(userId, mode),
  );
  if (isBlockedSource(source)) {
    await deps.announce(shameMessage(userId));
    await interaction.reply("🚫 Nope.");
    return;
  }

  if (source.kind === "file") {
    // Library match is already known-good — no yt-dlp call, so no added latency.
    deps.dispatch({
      type: next ? "ADD_NEXT" : "ADD",
      source,
      requesterId: userId,
    });
    await interaction.reply(ackMessage(sourceLabel(source), next, subtitles));
    return;
  }

  // url/search: resolve via yt-dlp before acking, so bad input gets a specific error instead of a
  // silent "Queued". The resolved result is threaded onto the queued item so the machine's
  // `resolving` state reuses it instead of re-fetching.
  await interaction.defer();
  let resolved: ResolvedSource;
  try {
    resolved = await deps.resolvePlaySource(
      source,
      AbortSignal.timeout(PLAY_RESOLVE_TIMEOUT_MS),
    );
  } catch (error) {
    if (error instanceof BlockedSourceError) {
      await deps.announce(shameMessage(userId));
      await interaction.editReply("🚫 Nope.");
      return;
    }
    await interaction.editReply(classifyPlayError(error, source.kind));
    return;
  }
  deps.dispatch({
    type: next ? "ADD_NEXT" : "ADD",
    source,
    requesterId: userId,
    preResolved: resolved,
  });
  await interaction.editReply(ackMessage(sourceLabel(source), next, subtitles));
}
