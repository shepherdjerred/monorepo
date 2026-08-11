import { PostHog } from "posthog-node";
import configuration, {
  type ProductAnalyticsConfiguration,
} from "#src/configuration.ts";
import { createLogger } from "#src/logger.ts";
import {
  productAnalyticsEventsTotal,
  productAnalyticsFailuresTotal,
} from "#src/metrics/product-analytics.ts";
import { getErrorMessage } from "#src/utils/errors.ts";

const logger = createLogger("product-analytics");

export type InstallKind = "first" | "reinstall";
export type MemberCountBucket =
  | "1-10"
  | "11-50"
  | "51-250"
  | "251-1000"
  | "1001+";
export type SubscriptionSurface = "discord" | "web";
export type CoreOutputKind =
  | "prematch"
  | "postmatch"
  | "report_scheduled"
  | "report_manual"
  | "competition_started"
  | "competition_ended"
  | "competition_leaderboard"
  | "pairing_weekly";
export type RemovalActivationState =
  | "installed_only"
  | "configured"
  | "activated";
export type TenureBucket = "<1d" | "1-6d" | "7-29d" | "30-89d" | "90d+";

type ProductAnalyticsEventProperties = {
  guild_installed: {
    install_kind: InstallKind;
    member_count_bucket: MemberCountBucket;
  };
  first_subscription_created: { surface: SubscriptionSurface };
  core_output_delivered: { output_kind: CoreOutputKind };
  first_core_output_delivered: { output_kind: CoreOutputKind };
  guild_removed: {
    activation_state: RemovalActivationState;
    tenure_bucket: TenureBucket;
  };
};

export type ProductAnalyticsEvent = {
  [EventName in keyof ProductAnalyticsEventProperties]: {
    event: EventName;
    properties: ProductAnalyticsEventProperties[EventName];
  };
}[keyof ProductAnalyticsEventProperties];

export type AnalyticsInstallation = {
  analyticsInstallationId: string;
  analyticsLifecycleTracked: boolean;
  /**
   * Discord guild id, sent as the `guild_id` property. `analyticsInstallationId`
   * rotates on reinstall by design, so it answers "how does one installation
   * behave"; `guild_id` is stable across reinstalls and answers "how does one
   * server behave over its whole history". Both are needed, and they are not
   * interchangeable.
   */
  serverId: string;
};

type CaptureProperties = Record<string, string | boolean>;

export type ProductAnalyticsTransport = {
  capture: (message: {
    distinctId: string;
    event: string;
    properties: CaptureProperties;
    disableGeoip: boolean;
  }) => void;
  shutdown: () => Promise<void>;
};

export type ProductAnalytics = {
  capture: (
    installation: AnalyticsInstallation,
    event: ProductAnalyticsEvent,
  ) => void;
  shutdown: () => Promise<void>;
};

function createPostHogTransport(
  analyticsConfiguration: ProductAnalyticsConfiguration,
): ProductAnalyticsTransport {
  const client = new PostHog(analyticsConfiguration.projectToken, {
    host: analyticsConfiguration.apiHost,
    // GeoIP enrichment is what gives the lifecycle events a country breakdown;
    // the SDK suppresses it unless this is explicitly false.
    disableGeoip: false,
    enableExceptionAutocapture: false,
    flushAt: 20,
    flushInterval: 10_000,
  });

  client.on("error", (error: unknown) => {
    productAnalyticsFailuresTotal.inc({ operation: "sdk" });
    logger.error("PostHog SDK delivery error", getErrorMessage(error));
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

export function createProductAnalytics(options: {
  analyticsConfiguration: ProductAnalyticsConfiguration | undefined;
  environment: "dev" | "beta" | "prod";
  version: string;
  transport?: ProductAnalyticsTransport;
}): ProductAnalytics {
  if (options.analyticsConfiguration === undefined) {
    return {
      capture() {
        return;
      },
      shutdown() {
        return Promise.resolve();
      },
    };
  }

  const analyticsConfiguration = options.analyticsConfiguration;
  const transport =
    options.transport ?? createPostHogTransport(analyticsConfiguration);

  return {
    capture(installation, event) {
      const distinctId = `${analyticsConfiguration.siteKey}:guild-install:${installation.analyticsInstallationId}`;
      try {
        transport.capture({
          distinctId,
          event: event.event,
          disableGeoip: false,
          properties: {
            ...event.properties,
            guild_id: installation.serverId,
            stage: options.environment,
            site_key: analyticsConfiguration.siteKey,
            site_hostname: analyticsConfiguration.siteHostname,
            source: "scout-backend",
            version: options.version,
            lifecycle_cohort: installation.analyticsLifecycleTracked
              ? "tracked"
              : "legacy",
          },
        });
        productAnalyticsEventsTotal.inc({ event: event.event });
      } catch (error) {
        productAnalyticsFailuresTotal.inc({ operation: "capture" });
        logger.error(
          `Failed to enqueue ${event.event} product analytics event`,
          getErrorMessage(error),
        );
      }
    },
    async shutdown() {
      try {
        await transport.shutdown();
      } catch (error) {
        productAnalyticsFailuresTotal.inc({ operation: "shutdown" });
        logger.error(
          "Failed to flush PostHog product analytics during shutdown",
          getErrorMessage(error),
        );
      }
    },
  };
}

let sharedProductAnalytics: ProductAnalytics | undefined;

export function getProductAnalytics(): ProductAnalytics {
  if (sharedProductAnalytics === undefined) {
    try {
      sharedProductAnalytics = createProductAnalytics({
        analyticsConfiguration: configuration.productAnalytics,
        environment: configuration.environment,
        version: configuration.version,
      });
    } catch (error) {
      productAnalyticsFailuresTotal.inc({ operation: "initialize" });
      logger.error(
        "Failed to initialize PostHog product analytics; analytics disabled",
        getErrorMessage(error),
      );
      sharedProductAnalytics = createProductAnalytics({
        analyticsConfiguration: undefined,
        environment: configuration.environment,
        version: configuration.version,
      });
    }
  }
  return sharedProductAnalytics;
}

export async function shutdownProductAnalytics(): Promise<void> {
  if (sharedProductAnalytics !== undefined) {
    await sharedProductAnalytics.shutdown();
  }
}
