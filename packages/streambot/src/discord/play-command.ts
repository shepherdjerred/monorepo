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
} from "@shepherdjerred/streambot/discord/command-handler.ts";
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

const PLAYLIST_TIMEOUT_MS = 60_000;
const PLAY_RESOLVE_TIMEOUT_MS = 30_000;

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
  const userId = interaction.userId;
  const query = interaction.getStringRequired("query");
  const subtitles = buildSubtitlePref(
    interaction.getString("subtitles"),
    interaction.getString("sublang"),
  );

  if (isHttpUrl(query) && isLikelyPlaylist(query)) {
    await interaction.defer();
    const items = await deps.expandPlaylist(
      query,
      AbortSignal.timeout(PLAYLIST_TIMEOUT_MS),
    );
    for (const item of items) {
      const source = { kind: "url", url: item.url, subtitles } as const;
      deps.dispatch({
        type: next ? "ADD_NEXT" : "ADD",
        source,
        requesterId: userId,
      });
    }
    await interaction.editReply(
      `Queued ${String(items.length)} item(s) from the playlist.${subtitlesSuffix(subtitles)}\n\nTip: ${randomTip()}`,
    );
    return;
  }

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
