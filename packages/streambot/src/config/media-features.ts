import { isEnabled } from "@shepherdjerred/feature-flags";
import type { StreambotBooleanFlagKey } from "@shepherdjerred/feature-flags/managed-flag-keys.generated.ts";
import type { DiscoveryScope } from "@shepherdjerred/streambot/discovery/candidate.ts";

export type MediaFeatureGate = {
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
  readonly numberedChannels?: (scope: DiscoveryScope) => Promise<boolean>;
  readonly automaticChannelRouting?: (
    scope: DiscoveryScope,
  ) => Promise<boolean>;
};

async function enabled(
  key: StreambotBooleanFlagKey,
  scope: DiscoveryScope,
): Promise<boolean> {
  const result = await isEnabled(key, {
    default: false,
    targetingKey: scope.userId,
    attributes: { server: scope.guildId, user: scope.userId },
  });
  return result.value;
}

export const mediaFeatureGate: MediaFeatureGate = {
  automaticChannelRouting: (scope) =>
    enabled("streambot-automatic-channel-routing-enabled", scope),
  numberedChannels: async (scope) => {
    const result = await isEnabled("streambot-numbered-channels-enabled", {
      default: false,
      targetingKey: scope.guildId,
      attributes: { server: scope.guildId },
    });
    return result.value;
  },
  assistantV2: (scope) => enabled("streambot-assistant-v2-enabled", scope),
  history: (scope) => enabled("streambot-history-enabled", scope),
  musicOverVoice: (scope) =>
    enabled("streambot-music-over-voice-enabled", scope),
  sportsStreaming: (scope) =>
    enabled("streambot-sports-streaming-enabled", scope),
};

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
