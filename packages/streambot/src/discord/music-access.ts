import type { CommandBotDeps } from "./commands/command-bot-deps.ts";
import type { MusicInteraction } from "./music-context.ts";
import { MusicError } from "@shepherdjerred/streambot/music/errors.ts";
import { MusicMatchError } from "@shepherdjerred/streambot/music/matching.ts";
import { PlaybackCommandBoundaryError } from "@shepherdjerred/streambot/commands/playback-command-errors.ts";

export function musicService(deps: CommandBotDeps) {
  if (deps.music === undefined) throw new Error("Music service is not wired");
  return deps.music;
}
export async function requireMusicFeature(
  deps: CommandBotDeps,
  interaction: MusicInteraction,
  feature: "musicCatalog" | "spotifyLinks" | "playlists",
) {
  if (interaction.guildId === null)
    throw new MusicError(
      400,
      "guild_required",
      "Use this command in a server.",
    );
  const enabled = await deps.featureGate?.[feature]?.({
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    userId: interaction.user.id,
  });
  if (enabled !== true || deps.music === undefined)
    throw new MusicError(
      403,
      "music_disabled",
      "This music feature is not enabled in this server yet.",
    );
}
export function musicErrorMessage(error: unknown) {
  if (error instanceof MusicError) return error.message;
  if (error instanceof PlaybackCommandBoundaryError) return error.message;
  return error instanceof MusicMatchError
    ? error.message
    : "Streambot is unavailable right now. Try again shortly.";
}
