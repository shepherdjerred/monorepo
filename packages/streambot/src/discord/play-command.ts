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
  withSubtitles,
  type SubtitlePref,
} from "@shepherdjerred/streambot/sources/source.ts";
import { isLikelyPlaylist } from "@shepherdjerred/streambot/sources/ytdlp.ts";
import {
  BlockedSourceError,
  isBlockedSource,
  shameMessage,
} from "@shepherdjerred/streambot/moderation/adult-block.ts";
import type { ResolvedSource } from "@shepherdjerred/streambot/machine/types.ts";
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

  if (isHttpUrl(query) && isLikelyPlaylist(query)) {
    await runPlaylist({ deps, interaction, query, subtitles, next });
    return;
  }

  if (deps.discovery !== undefined) {
    await runDiscoveredPlay({
      deps,
      interaction,
      query,
      subtitles,
      next,
      source: selectedSource,
      placement: selectedPlacement,
    });
    return;
  }

  await runLegacyPlay({ deps, interaction, query, subtitles, next });
}

async function runPlaylist(input: PlayCommandInput): Promise<void> {
  const { deps, interaction, query, subtitles, next } = input;
  await interaction.defer();
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
  const historyEnabled =
    scope !== null &&
    deps.history !== undefined &&
    (deps.featureGate === undefined || (await deps.featureGate.history(scope)));
  for (const item of items) {
    const source = { kind: "url", url: item.url, subtitles } as const;
    const requestId = historyEnabled
      ? deps.history.recordQueueRequest({
          scope,
          rawQuery: item.title,
          intent: inferMediaIntent({
            query: item.title,
            source: "youtube",
            placement: next ? "next" : "queue",
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
      type: next ? "ADD_NEXT" : "ADD",
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
  const { deps, interaction, query, subtitles, source, placement } = input;
  await interaction.defer();
  try {
    const result = await new PlaybackCommandService(deps).play({
      query,
      source,
      placement,
      userId: interaction.userId,
      spoken: false,
      ...(subtitles === undefined ? {} : { subtitles }),
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
  const { deps, interaction, query, subtitles, next } = input;
  const userId = interaction.userId;

  const source = withSubtitles(
    resolvePlayQuery(query, deps.library()),
    subtitles,
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
