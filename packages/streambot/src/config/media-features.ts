import { isEnabled } from "@shepherdjerred/feature-flags";
import type { DiscoveryScope } from "@shepherdjerred/streambot/discovery/candidate.ts";

export type MediaFeatureGate = {
  readonly assistantV2: (scope: DiscoveryScope) => Promise<boolean>;
  readonly history: (scope: DiscoveryScope) => Promise<boolean>;
};

async function enabled(key: string, scope: DiscoveryScope): Promise<boolean> {
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
};
