import { PostHog } from "posthog-node";
import {
  analyticsEventsTotal,
  type AnalyticsOutcome,
} from "@shepherdjerred/streambot/observability/analytics-metrics.ts";
import { AnalyticsIdentityStore } from "@shepherdjerred/streambot/observability/analytics-identity.ts";
import type {
  PlaySurface,
  TelemetryOutcome,
  WebCommandAction,
  WebErrorCode,
} from "@shepherdjerred/streambot/observability/web-metrics.ts";
import type {
  MediaSelectionSchema,
  WebStationScopeSchema,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";
import type { PlaylistMutationSchema } from "@shepherdjerred/streambot/music/playlist-contracts.ts";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";
import type { z } from "zod";

const log = logger.child("analytics");

// Privacy contract: every property below is a member of a closed set, a boolean or a bucket. No
// Discord id, name, title, query or URL can be typed into an event, and the distinct id is a
// random UUID whose mapping to a Discord user never leaves this process.

export type PlayPlacement = "queue" | "next" | "now";
export type SelectionKind = z.infer<typeof MediaSelectionSchema>["kind"];
export type StationScope = z.infer<typeof WebStationScopeSchema>;
export type PlaylistAction = z.infer<typeof PlaylistMutationSchema>["action"];
export type SearchSource = "library" | "candidates" | "music";
export const LATENCY_BUCKETS = [
  "<250ms",
  "250-1000ms",
  "1-3s",
  "3-10s",
  ">10s",
] as const;
export type LatencyBucket = (typeof LATENCY_BUCKETS)[number];

export function latencyBucket(milliseconds: number): LatencyBucket {
  if (milliseconds < 250) return "<250ms";
  if (milliseconds < 1000) return "250-1000ms";
  if (milliseconds < 3000) return "1-3s";
  return milliseconds < 10_000 ? "3-10s" : ">10s";
}

type UsageEventProperties = {
  streambot_play_requested: {
    surface: PlaySurface;
    outcome: TelemetryOutcome;
    placement: PlayPlacement;
    batch: boolean;
    selection_kind?: SelectionKind;
  };
  streambot_command_used: {
    surface: "web";
    action: WebCommandAction;
    outcome: TelemetryOutcome;
    code: WebErrorCode;
  };
  streambot_web_signed_in: { outcome: "success" };
  streambot_search_performed: {
    surface: "web";
    source: SearchSource;
    had_results: boolean;
    latency_bucket: LatencyBucket;
  };
  streambot_station_started: {
    kind: "radio" | "tv";
    scope: StationScope;
  };
  streambot_playlist_action: { action: PlaylistAction };
};

export type UsageEvent = {
  [Name in keyof UsageEventProperties]: {
    event: Name;
    properties: UsageEventProperties[Name];
  };
}[keyof UsageEventProperties];

export type UsageTransportMessage = {
  distinctId: string;
  event: string;
  properties: Record<string, string | number | boolean>;
  disableGeoip: boolean;
};

export type UsageTransport = {
  capture: (message: UsageTransportMessage) => void;
  shutdown: () => Promise<void>;
};

export type UsageAnalytics = {
  /** Never throws and never waits; the outcome is only counted. */
  capture: (userId: string, event: UsageEvent) => void;
  /** The pseudonymous id for a Discord user, minted on first use; `undefined` when it cannot be. */
  analyticsId: (userId: string) => string | undefined;
  shutdown: () => Promise<void>;
};

export type UsageAnalyticsOptions = {
  identities: AnalyticsIdentityStore;
  /** Read on every capture so the Flipt-backed value takes effect without a restart. */
  enabled: () => boolean;
  /** Absent while the destination is not configured; events are then counted as disabled. */
  transport?: UsageTransport | undefined;
};

export function createUsageAnalytics(
  options: UsageAnalyticsOptions,
): UsageAnalytics {
  return {
    analyticsId(userId) {
      try {
        return options.identities.idFor(userId);
      } catch {
        log.warn("analytics identity lookup failed");
        return;
      }
    },
    capture(userId, event) {
      try {
        const transport = options.transport;
        if (transport === undefined || !options.enabled()) {
          count(event.event, "disabled");
          return;
        }
        const distinctId = options.identities.idFor(userId);
        if (distinctId === undefined) {
          count(event.event, "dropped");
          return;
        }
        transport.capture({
          distinctId,
          event: event.event,
          disableGeoip: true,
          properties: { ...event.properties, app: "streambot" },
        });
        count(event.event, "captured");
      } catch {
        count(event.event, "failed");
        log.warn("analytics capture failed", { event: event.event });
      }
    },
    async shutdown() {
      try {
        await options.transport?.shutdown();
      } catch {
        log.warn("analytics flush on shutdown failed");
      }
      options.identities.close();
    },
  };
}

export function createPostHogTransport(destination: {
  projectToken: string;
  apiHost: string;
}): UsageTransport {
  const client = new PostHog(destination.projectToken, {
    host: destination.apiHost,
    // Server events have no end-user IP; GeoIP would label Streambot's own egress location.
    disableGeoip: true,
    enableExceptionAutocapture: false,
    flushAt: 20,
    flushInterval: 10_000,
  });
  client.on("error", () => {
    count("delivery", "failed");
    log.warn("analytics delivery failed");
  });
  return {
    capture(message) {
      client.capture(message);
    },
    async shutdown() {
      await client.shutdown();
    },
  };
}

/**
 * The transport `main` installs. Startup fails when usage capture is on and
 * the PostHog destination is absent; an explicit off returns no transport.
 */
export function usageAnalyticsTransport(
  analytics: Config["analytics"],
): UsageTransport | undefined {
  const { enabled, posthog } = analytics;
  if (posthog !== undefined) return createPostHogTransport(posthog);
  if (enabled) {
    throw new Error(
      "Usage analytics is enabled but POSTHOG_PROJECT_TOKEN and POSTHOG_API_HOST are not set",
    );
  }
  return;
}

function count(event: string, outcome: AnalyticsOutcome): void {
  analyticsEventsTotal.inc({ event, outcome });
}

// Until the entry point installs the real instance, usage is counted as disabled and ids are
// kept in memory only, so tests and tools that never configure analytics send nothing.
let current: UsageAnalytics = createUsageAnalytics({
  identities: new AnalyticsIdentityStore(":memory:"),
  enabled: () => false,
});

export function installUsageAnalytics(instance: UsageAnalytics): void {
  current = instance;
}

export function usageAnalytics(): UsageAnalytics {
  return current;
}

export async function shutdownUsageAnalytics(): Promise<void> {
  await current.shutdown();
}
