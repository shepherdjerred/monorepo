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
  assistantV2: (scope) => enabled("streambot-assistant-v2-enabled", scope),
  history: (scope) => enabled("streambot-history-enabled", scope),
  musicOverVoice: (scope) =>
    enabled("streambot-music-over-voice-enabled", scope),
};
