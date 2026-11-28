import { isEnabled, stringValue } from "@shepherdjerred/feature-flags";
import { DEFAULT_MUSIC_SEARCH_PROVIDER } from "@shepherdjerred/streambot/music/search-provider.ts";
import { managedBooleanDefault } from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";
import type { StreambotBooleanFlagKey } from "@shepherdjerred/feature-flags/managed-flag-keys.generated.ts";
import type { DiscoveryScope } from "@shepherdjerred/streambot/discovery/candidate.ts";

export type MediaFeatureGate = {
  readonly musicCatalog?: (scope: DiscoveryScope) => Promise<boolean>;
  readonly spotifyLinks?: (scope: DiscoveryScope) => Promise<boolean>;
  readonly playlists?: (scope: DiscoveryScope) => Promise<boolean>;
  readonly radio?: (scope: DiscoveryScope) => Promise<boolean>;
  readonly tv?: (scope: DiscoveryScope) => Promise<boolean>;
  readonly assistantV2: (scope: DiscoveryScope) => Promise<boolean>;
  readonly history: (scope: DiscoveryScope) => Promise<boolean>;
  /**
   * Route music over the normal voice connection instead of a Go Live video stream. Off means
   * every item resolves as `video`, which is exactly the behaviour that shipped before the split —
   * so a rollback is a flag flip rather than a deploy. Evaluated at the command layer, the only
   * place with a {@link DiscoveryScope}, and stamped onto the `Source`; already-queued items keep
   * the mode they were stamped with rather than changing transport mid-queue.
   */
  readonly musicOverVoice: (scope: DiscoveryScope) => Promise<boolean>;
  readonly sportsStreaming?: (scope: DiscoveryScope) => Promise<boolean>;
  readonly lolEsports?: (scope: DiscoveryScope) => Promise<boolean>;
  readonly lolAutoplay?: (scope: DiscoveryScope) => Promise<boolean>;
  readonly numberedChannels?: (scope: DiscoveryScope) => Promise<boolean>;
  readonly automaticChannelRouting?: (
    scope: DiscoveryScope,
  ) => Promise<boolean>;
  readonly voiceDecisionsRouter?: (scope: DiscoveryScope) => Promise<boolean>;
};

/** Guild-scoped evaluation, for decisions made where no requesting user is in hand. */
async function guildEnabled(
  key: StreambotBooleanFlagKey,
  guildId: string,
): Promise<boolean> {
  const result = await isEnabled(key, {
    default: managedBooleanDefault(key),
    targetingKey: guildId,
    attributes: { server: guildId },
  });
  return result.value;
}

async function enabled(
  key: StreambotBooleanFlagKey,
  scope: DiscoveryScope,
): Promise<boolean> {
  const result = await isEnabled(key, {
    default: managedBooleanDefault(key),
    targetingKey: scope.userId,
    attributes: { server: scope.guildId, user: scope.userId },
  });
  return result.value;
}

export const mediaFeatureGate: MediaFeatureGate = {
  musicCatalog: (scope) => enabled("streambot-music-catalog-enabled", scope),
  spotifyLinks: (scope) => enabled("streambot-spotify-links-enabled", scope),
  playlists: (scope) => enabled("streambot-playlists-enabled", scope),
  radio: (scope) => enabled("streambot-radio-enabled", scope),
  tv: (scope) => enabled("streambot-tv-enabled", scope),
  lolEsports: (scope) => enabled("streambot-lol-esports-enabled", scope),
  lolAutoplay: (scope) => enabled("streambot-lol-autoplay-enabled", scope),
  automaticChannelRouting: (scope) =>
    enabled("streambot-automatic-channel-routing-enabled", scope),
  numberedChannels: (scope) =>
    guildEnabled("streambot-numbered-channels-enabled", scope.guildId),
  assistantV2: (scope) => enabled("streambot-assistant-v2-enabled", scope),
  history: (scope) => enabled("streambot-history-enabled", scope),
  musicOverVoice: (scope) =>
    enabled("streambot-music-over-voice-enabled", scope),
  sportsStreaming: (scope) =>
    enabled("streambot-sports-streaming-enabled", scope),
  voiceDecisionsRouter: (scope) =>
    enabled("streambot-voice-decisions-router-enabled", scope),
};

/**
 * The audio-processing switches one playback segment runs with. Each is independent, and each one
 * off restores exactly its part of the ffmpeg audio stage that shipped before it existed.
 */
export type AudioProcessingFlags = {
  /** 5.1/7.1 sources downmix through a dialogue-first `pan` and a limiter, not `-ac 2`. */
  readonly dialogDownmix: boolean;
  /** Realtime loudness normalisation ahead of the volume filter, on video and music. */
  readonly loudnessNormalization: boolean;
  /** Discontinuous live audio is resampled onto its timestamps (`aresample=async=1`). */
  readonly liveResync: boolean;
  /** Play the probe-ranked audio track and HLS video variant instead of the first usable one. */
  readonly trackRanking: boolean;
};

/**
 * Evaluated by the streamer once per playback segment (a seek reuses its segment's options), so a
 * flip applies from the next item, retry or fallback without touching one already running. The
 * streaming call site has the voice handle (guild + channel) and not the requester, so these
 * target the guild, as `streambot-numbered-channels-enabled` does.
 */
export async function audioProcessingFlags(
  guildId: string,
): Promise<AudioProcessingFlags> {
  const [dialogDownmix, loudnessNormalization, liveResync, trackRanking] =
    await Promise.all([
      guildEnabled("streambot-audio-dialog-downmix-enabled", guildId),
      guildEnabled("streambot-audio-loudness-normalization-enabled", guildId),
      guildEnabled("streambot-audio-live-resync-enabled", guildId),
      guildEnabled("streambot-audio-track-ranking-enabled", guildId),
    ]);
  return { dialogDownmix, loudnessNormalization, liveResync, trackRanking };
}

/**
 * Which provider answers music search: `youtube-music` or `musicbrainz`. Read per request so a flag
 * flip applies at once. The provider registry rejects any other value instead of defaulting it.
 */
export async function musicSearchProviderName(
  scope: DiscoveryScope,
): Promise<string> {
  const result = await stringValue("streambot-music-search-provider", {
    default: DEFAULT_MUSIC_SEARCH_PROVIDER,
    targetingKey: scope.userId,
    attributes: { server: scope.guildId, user: scope.userId },
  });
  return result.value;
}

export async function webUiEnabled(
  guildId: string,
  userId: string,
): Promise<boolean> {
  return await enabled("streambot-web-ui-enabled", {
    guildId,
    userId,
    channelId: "web",
  });
}

export async function plexPostersEnabled(
  guildId: string,
  userId: string,
): Promise<boolean> {
  return await enabled("streambot-plex-posters-enabled", {
    guildId,
    userId,
    channelId: "web",
  });
}
