import { PostHog } from "posthog-node";
import type { BucksLedgerKind } from "@scout-for-lol/data";
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
  "1-10" | "11-50" | "51-250" | "251-1000" | "1001+";
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
  "installed_only" | "configured" | "activated";
export type TenureBucket = "<1d" | "1-6d" | "7-29d" | "30-89d" | "90d+";
export type AttributionSurface = "guild_picker" | "onboarding_wizard";
export type AttributionTiming = "before_gateway" | "after_gateway";
export type DiscordCommandName =
  | "help"
  | "setup"
  | "status"
  | "invite"
  | "docs"
  | "track"
  | "list"
  | "bb"
  | "scout";
export type DiscordCommandStatus = "success" | "error";
export type BucksMemberActivityKind =
  | "command"
  | "outcome_bet"
  | "parlay_bet"
  | "weekly_parlay_bet"
  | "peek_pass"
  | "ask"
  | "navigation";
export type BucksActivitySurface = "command" | "button";
export type BucksLifecycleTransition =
  | "bucks.pool.opened"
  | "bucks.pool.closed"
  | "bucks.pool.settled"
  | "bucks.pool.voided"
  | "bucks.bet.placed"
  | "bucks.bet.topped_up"
  | "bucks.bet.rejected"
  | "bucks.bet.cancelled"
  | "bucks.bet.matched"
  | "bucks.bet.unmatched_refunded"
  | "bucks.bet.house_filled"
  | "bucks.bet.won"
  | "bucks.bet.lost"
  | "bucks.bet.refunded"
  | "bucks.parlay.published"
  | "bucks.parlay.opened"
  | "bucks.parlay.closed"
  | "bucks.parlay.settled"
  | "bucks.parlay.voided"
  | "bucks.parlay_bet.placed"
  | "bucks.parlay_bet.cancelled"
  | "bucks.parlay_bet.settled"
  | "bucks.weekly_parlay.published"
  | "bucks.weekly_parlay.opened"
  | "bucks.weekly_parlay.started"
  | "bucks.weekly_parlay.settled"
  | "bucks.weekly_parlay.voided"
  | "bucks.weekly_parlay_bet.placed"
  | "bucks.weekly_parlay_bet.topped_up"
  | "bucks.weekly_parlay_bet.cancelled"
  | "bucks.weekly_parlay_bet.settled"
  | "bucks.weekly_parlay.contribution_recorded"
  | "bucks.earning.awarded"
  | "bucks.peek_pass.purchased";

export type ProductAnalyticsEventOptions = {
  timestamp?: Date | undefined;
  uuid?: string | undefined;
};

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
  discord_command_used: {
    command_name: DiscordCommandName;
    status: DiscordCommandStatus;
  };
  guild_install_attributed: {
    attribution_surface: AttributionSurface;
    attribution_timing: AttributionTiming;
  };
  bryan_bucks_member_activity: {
    activity_kind: BucksMemberActivityKind;
    surface: BucksActivitySurface;
    status: DiscordCommandStatus;
  };
  bryan_bucks_lifecycle: {
    transition: BucksLifecycleTransition;
    amount_bucks?: number | undefined;
    matched_bucks?: number | undefined;
    payout_bucks?: number | undefined;
    balance_after_bucks?: number | undefined;
  };
  bryan_bucks_economy: {
    movement: BucksLedgerKind;
    delta_bucks: number;
    balance_after_bucks: number;
  };
  bryan_bucks_economy_snapshot: {
    member_accounts: number;
    total_member_balance_bucks: number;
    pending_stake_bucks: number;
    house_balance_bucks: number;
    open_markets: number;
  };
};

export type ProductAnalyticsEvent = {
  [EventName in keyof ProductAnalyticsEventProperties]: {
    event: EventName;
    properties: ProductAnalyticsEventProperties[EventName];
  };
}[keyof ProductAnalyticsEventProperties];

type BucksMemberAnalyticsEvent = Extract<
  ProductAnalyticsEvent,
  { event: "bryan_bucks_member_activity" }
>;
type BucksSystemAnalyticsEvent = Extract<
  ProductAnalyticsEvent,
  {
    event:
      | "bryan_bucks_lifecycle"
      | "bryan_bucks_economy"
      | "bryan_bucks_economy_snapshot";
  }
>;

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

type CaptureProperties = Record<string, string | number | boolean>;

export type ProductAnalyticsTransport = {
  capture: (message: {
    distinctId: string;
    event: string;
    properties: CaptureProperties;
    disableGeoip: boolean;
    timestamp?: Date;
    uuid?: string;
  }) => void;
  shutdown: () => Promise<void>;
};

export type ProductAnalytics = {
  capture: (
    installation: AnalyticsInstallation,
    event: ProductAnalyticsEvent,
    options?: ProductAnalyticsEventOptions,
  ) => void;
  captureBucksMember: (
    member: { analyticsUserId: string; serverId: string },
    event: BucksMemberAnalyticsEvent,
    options?: ProductAnalyticsEventOptions,
  ) => void;
  captureBucksSystem: (
    serverId: string,
    event: BucksSystemAnalyticsEvent,
    options?: ProductAnalyticsEventOptions,
  ) => void;
  shutdown: () => Promise<void>;
};

type CapturePropertyValue = string | number | boolean | undefined;

type CaptureInput = {
  distinctId: string;
  serverId: string;
  event: ProductAnalyticsEvent;
  eventOptions?: ProductAnalyticsEventOptions | undefined;
  additionalProperties?: Record<string, CapturePropertyValue>;
};

function omitUndefinedProperties(
  properties: Record<string, CapturePropertyValue>,
): CaptureProperties {
  const result: CaptureProperties = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function createPostHogTransport(
  analyticsConfiguration: ProductAnalyticsConfiguration,
): ProductAnalyticsTransport {
  const client = new PostHog(analyticsConfiguration.projectToken, {
    host: analyticsConfiguration.apiHost,
    // These captures originate from Discord gateway events and background
    // database/delivery workflows, never from an end-user request, and the
    // transport supplies no `$ip`. GeoIP would therefore describe this
    // backend's own egress location — one datacenter, identical on every
    // event — and label it as the guild's, which is worse than no geography.
    disableGeoip: true,
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
      captureBucksMember() {
        return;
      },
      captureBucksSystem() {
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

  const capture = ({
    distinctId,
    serverId,
    event,
    eventOptions,
    additionalProperties = {},
  }: CaptureInput): void => {
    try {
      const metadata: { timestamp?: Date; uuid?: string } = {};
      if (eventOptions?.timestamp !== undefined) {
        metadata.timestamp = eventOptions.timestamp;
      }
      if (eventOptions?.uuid !== undefined) {
        metadata.uuid = eventOptions.uuid;
      }
      const message = {
        distinctId,
        event: event.event,
        disableGeoip: true,
        properties: omitUndefinedProperties({
          ...event.properties,
          ...additionalProperties,
          ...(eventOptions?.uuid === undefined
            ? {}
            : { $insert_id: eventOptions.uuid }),
          guild_id: serverId,
          stage: options.environment,
          site_key: analyticsConfiguration.siteKey,
          site_hostname: analyticsConfiguration.siteHostname,
          source: "scout-backend",
          version: options.version,
        }),
        ...metadata,
      };
      transport.capture(message);
      productAnalyticsEventsTotal.inc({ event: event.event });
    } catch (error) {
      productAnalyticsFailuresTotal.inc({ operation: "capture" });
      logger.error(
        `Failed to enqueue ${event.event} product analytics event`,
        getErrorMessage(error),
      );
    }
  };

  return {
    capture(installation, event, eventOptions) {
      capture({
        distinctId: `${analyticsConfiguration.siteKey}:guild-install:${installation.analyticsInstallationId}`,
        serverId: installation.serverId,
        event,
        eventOptions,
        additionalProperties: {
          lifecycle_cohort: installation.analyticsLifecycleTracked
            ? "tracked"
            : "legacy",
        },
      });
    },
    captureBucksMember(member, event, eventOptions) {
      capture({
        distinctId: `${analyticsConfiguration.siteKey}:bucks-member:${member.analyticsUserId}`,
        serverId: member.serverId,
        event,
        eventOptions,
      });
    },
    captureBucksSystem(serverId, event, eventOptions) {
      capture({
        distinctId: `${analyticsConfiguration.siteKey}:bryan-bucks-system`,
        serverId,
        event,
        eventOptions,
      });
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
