import posthog, { type CaptureOptions } from "posthog-js";
import { z } from "zod";

/**
 * Product analytics for the Scout SPA, backed by PostHog Cloud.
 *
 * The production and beta release builds inject a public project token and a
 * per-host site identity. Local builds omit every PostHog variable, so the
 * adapter no-ops. Persistence is PostHog's default (cookie + localStorage) so a
 * visitor keeps one distinct id across reloads and the Discord OAuth redirect;
 * `identify` then binds that id to the signed-in user. Do Not Track is still
 * honoured, so DNT browsers send nothing at all.
 */
const OptionalEnvSchema = z.object({
  VITE_POSTHOG_PROJECT_TOKEN: z.string().optional(),
  VITE_POSTHOG_API_HOST: z.string().optional(),
  VITE_POSTHOG_ASSET_HOST: z.string().optional(),
  VITE_POSTHOG_SITE_KEY: z.string().optional(),
  VITE_POSTHOG_SITE_DOMAIN: z.string().optional(),
  VITE_POSTHOG_SESSION_REPLAY: z.string().optional(),
});
const RequiredEnvSchema = z.object({
  VITE_POSTHOG_PROJECT_TOKEN: z.string().regex(/^phc_[A-Za-z0-9]+$/),
  VITE_POSTHOG_API_HOST: z.literal("https://us.i.posthog.com"),
  VITE_POSTHOG_ASSET_HOST: z.literal("https://us-assets.i.posthog.com"),
  VITE_POSTHOG_SITE_KEY: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  VITE_POSTHOG_SITE_DOMAIN: z.string().min(1),
  VITE_POSTHOG_SESSION_REPLAY: z.enum(["true", "false"]),
});

export type AnalyticsConfig = {
  projectToken: string;
  apiHost: "https://us.i.posthog.com";
  assetHost: "https://us-assets.i.posthog.com";
  siteKey: string;
  siteDomain: string;
  sessionReplay: boolean;
};

function readConfig(): AnalyticsConfig | undefined {
  const optional = OptionalEnvSchema.parse(import.meta.env);
  if (Object.values(optional).every((value) => value === undefined)) {
    return undefined;
  }
  const env = RequiredEnvSchema.parse(optional);
  return {
    projectToken: env.VITE_POSTHOG_PROJECT_TOKEN,
    apiHost: env.VITE_POSTHOG_API_HOST,
    assetHost: env.VITE_POSTHOG_ASSET_HOST,
    siteKey: env.VITE_POSTHOG_SITE_KEY,
    siteDomain: env.VITE_POSTHOG_SITE_DOMAIN,
    sessionReplay: env.VITE_POSTHOG_SESSION_REPLAY === "true",
  };
}

const BASENAME = "/app";

/** Every product-analytics event the app can emit. */
const SCOUT_ANALYTICS_EVENTS = [
  // Reports
  "report_created",
  "report_updated",
  "report_deleted",
  "report_run",
  "report_enabled_toggled",
  // ScoutQL editor
  "report_preset_used",
  "data_explorer_action",
  // AI editor
  "ai_edit_started",
  "ai_edit_applied",
  "ai_edit_cancelled",
  "ai_edit_error",
  // Subscriptions
  "subscription_add",
  "subscription_removed",
  "subscription_muted",
  "subscription_unmuted",
  "subscription_filters_set",
  "subscription_channel_filters_set",
  "subscription_channel_added",
  "subscription_moved",
  // Players
  "player_account_added",
  "player_account_edited",
  "player_account_transferred",
  "player_account_deleted",
  "player_discord_linked",
  "player_discord_unlinked",
  "player_renamed",
  "players_merged",
  "player_deleted",
  // Competitions
  "competition_created",
  "competition_edited",
  "competition_cancelled",
  "competition_participant_invited",
  "competition_members_added_all",
  "competition_participant_removed",
  "competition_leaderboard_refreshed",
  // Access (RBAC)
  "access_granted",
  "access_updated",
  "access_revoked",
  // Funnel / entry
  "onboarding_step",
  "onboarding_completed",
  "onboarding_skipped",
  "bot_install_click",
  "login_click",
  "sign_out",
  "theme_changed",
  // Feedback prompt
  "feedback_shown",
  "feedback_submitted",
  "feedback_dismissed",
] as const;

export type ScoutAnalyticsEvent = (typeof SCOUT_ANALYTICS_EVENTS)[number];

const EVENT_SET: ReadonlySet<string> = new Set(SCOUT_ANALYTICS_EVENTS);

/** Only these low-cardinality properties may be sent to PostHog. */
export type AnalyticsProperty =
  | "outcome"
  | "reason"
  | "kind"
  | "category"
  | "preference"
  | "action"
  | "step"
  | "has_existing_query";

export type AnalyticsProps = Partial<
  Record<AnalyticsProperty, string | number | boolean>
>;

type PostHogProperties = Record<string, string | number | boolean>;
type CaptureEvent = (
  event: string,
  properties?: PostHogProperties,
  options?: CaptureOptions,
) => void;

/**
 * The PostHog surface this module uses, injected as one object so identity
 * calls are as testable as captures — see `setAnalyticsForTesting`.
 */
type AnalyticsClient = {
  capture: CaptureEvent;
  identify: (distinctId: string) => void;
  reset: () => void;
  /** Whether PostHog currently holds an identified (not anonymous) person. */
  isIdentified: () => boolean;
  register: (properties: PostHogProperties) => void;
  registerForSession: (properties: PostHogProperties) => void;
  unregisterForSession: (property: string) => void;
};

/** Super property carrying the active Discord guild. */
const GUILD_PROPERTY = "guild_id";

let config = readConfig();
let client: AnalyticsClient | undefined;
let initialized = false;
let identifiedUser: string | undefined;

/** Inject a deterministic client/config in unit tests without module mocking. */
export function setAnalyticsForTesting(
  testClient: AnalyticsClient | undefined,
  testConfig: AnalyticsConfig | undefined,
): void {
  client = testClient;
  config = testConfig;
  initialized = false;
  identifiedUser = undefined;
}

export function analyticsPrivacySettings(activeConfig: AnalyticsConfig): {
  autocapture: true;
  capture_pageview: false;
  capture_pageleave: true;
  capture_heatmaps: true;
  capture_dead_clicks: true;
  capture_performance: { web_vitals: true; network_timing: true };
  respect_dnt: true;
  person_profiles: "always";
  session_recording: { maskAllInputs: true };
  disable_session_recording: boolean;
} {
  return {
    autocapture: true,
    // The SPA captures pageviews itself so every URL passes through
    // `normalizePath` before it reaches PostHog.
    capture_pageview: false,
    capture_pageleave: true,
    capture_heatmaps: true,
    capture_dead_clicks: true,
    capture_performance: { web_vitals: true, network_timing: true },
    respect_dnt: true,
    person_profiles: "always",
    session_recording: { maskAllInputs: true },
    disable_session_recording: !activeConfig.sessionReplay,
  };
}

/** Load PostHog with anonymous in-memory persistence and normalized URLs. */
export function initAnalytics(): void {
  if (initialized || config === undefined) return;
  if (typeof document === "undefined") return;
  initialized = true;
  const activeConfig = config;
  posthog.init(activeConfig.projectToken, {
    api_host: activeConfig.apiHost,
    asset_host: activeConfig.assetHost,
    ui_host: "https://us.posthog.com",
    defaults: "2026-05-30",
    ...analyticsPrivacySettings(activeConfig),
    before_send(event) {
      if (event === null) return null;
      const currentUrl: unknown = event.properties["$current_url"];
      if (typeof currentUrl === "string") {
        const location = normalizedEventLocation(activeConfig, currentUrl);
        event.properties["$current_url"] = location.url;
        event.properties["$pathname"] = location.pathname;
      }
      return event;
    },
    loaded(instance) {
      instance.register({
        site_key: activeConfig.siteKey,
        site_hostname: activeConfig.siteDomain,
      });
    },
  });
  client = {
    capture: (event, properties, options) => {
      posthog.capture(event, properties, options);
    },
    identify: (distinctId) => {
      posthog.identify(distinctId);
    },
    reset: () => {
      posthog.reset();
    },
    isIdentified: () => posthog._isIdentified(),
    register: (properties) => {
      posthog.register(properties);
    },
    registerForSession: (properties) => {
      posthog.register_for_session(properties);
    },
    unregisterForSession: (property) => {
      posthog.unregister_for_session(property);
    },
  };
}

/**
 * Bind the session to the signed-in Discord user. Idempotent per id: PostHog
 * merges the pre-login anonymous person into this one on the first call, and
 * repeating it on every render would emit redundant `$identify` events.
 */
export function identifyUser(discordId: string): void {
  if (client === undefined || identifiedUser === discordId) return;
  identifiedUser = discordId;
  client.identify(discordId);
}

/**
 * Drop the identified person so a shared browser never merges two users.
 *
 * Safe to call on every anonymous render: `_isIdentified` reads PostHog's
 * persisted user state, so this resets exactly when a Discord identity is still
 * attached — after an explicit sign-out and equally after an expired or revoked
 * cookie, where no logout handler ever runs. Resetting unconditionally would
 * mint a fresh distinct id for ordinary anonymous visitors, which is the
 * unique-visitor regression durable persistence exists to prevent.
 */
export function resetIdentity(): void {
  identifiedUser = undefined;
  const activeClient = client;
  if (activeClient?.isIdentified() === true) activeClient.reset();
}

/**
 * Attach the active guild to every subsequent event, autocapture and pageviews
 * included. Registered as a super property rather than passed per event because
 * `AnalyticsProperty` is a deliberately low-cardinality allowlist.
 *
 * Session-scoped, not durable: the clearing side of this lives in a React
 * effect cleanup, which a hard navigation or a closed tab never runs. A durable
 * super property would then survive in localStorage and attribute a later,
 * unrelated visit to the guild the user happened to leave open.
 */
export function setGuildContext(guildId: string | undefined): void {
  if (client === undefined) return;
  if (guildId === undefined) {
    client.unregisterForSession(GUILD_PROPERTY);
    return;
  }
  client.registerForSession({ [GUILD_PROPERTY]: guildId });
}

/**
 * Collapse dynamic route segments to templates so pageviews group by shape
 * instead of exposing guild/report/player identifiers.
 */
export function normalizePath(pathname: string): string {
  const normalized = pathname
    .replace(/^\/g\/[^/]+/, "/g/:guildId")
    .replace(/\/players\/[^/]+/, "/players/:alias")
    .replace(
      /\/competitions\/(?!new(?:\/|$))[^/]+/,
      "/competitions/:competitionId",
    )
    .replace(
      /\/reports\/(?!new(?:\/|$)|help(?:\/|$))[^/]+/,
      "/reports/:reportId",
    );
  const knownRoute =
    /^(?:\/|\/(?:login|welcome|installed)|\/g\/:guildId(?:\/(?:access|audit|subscriptions|players(?:\/:alias)?|competitions(?:\/(?:new|:competitionId(?:\/edit)?))?|reports(?:\/(?:new|help|:reportId(?:\/edit)?))?)?)?)$/;
  return knownRoute.test(normalized) ? normalized : "/not-found";
}

function pageUrl(siteDomain: string, normalizedPath: string): string {
  return `https://${siteDomain}${BASENAME}${normalizedPath}`;
}

function normalizedEventLocation(
  activeConfig: AnalyticsConfig,
  url: string,
): { url: string; pathname: string } {
  const parsed = new URL(url);
  const path = parsed.pathname.startsWith(BASENAME)
    ? parsed.pathname.slice(BASENAME.length) || "/"
    : parsed.pathname;
  const normalizedPath = normalizePath(path);
  return {
    url: pageUrl(activeConfig.siteDomain, normalizedPath),
    pathname: `${BASENAME}${normalizedPath}`,
  };
}

function currentEventUrl(): string | undefined {
  if (config === undefined || typeof document === "undefined") {
    return undefined;
  }
  const raw = globalThis.location.pathname;
  const path = raw.startsWith(BASENAME)
    ? raw.slice(BASENAME.length) || "/"
    : raw;
  return pageUrl(config.siteDomain, normalizePath(path));
}

function analyticsReady(): boolean {
  return config !== undefined && client !== undefined;
}

/** Report a templated SPA pageview. */
export function trackPageview(path: string): void {
  if (config === undefined || client === undefined) return;
  const normalizedPath = normalizePath(path);
  const properties: PostHogProperties = {
    $current_url: pageUrl(config.siteDomain, normalizedPath),
    $pathname: `${BASENAME}${normalizedPath}`,
    $host: config.siteDomain,
    site_key: config.siteKey,
    site_hostname: config.siteDomain,
  };
  if (typeof document === "object") properties["$title"] = document.title;
  client.capture("$pageview", properties);
}

function eventProperties(
  props?: AnalyticsProps,
): PostHogProperties | undefined {
  if (config === undefined) return undefined;
  const url = currentEventUrl();
  return {
    ...props,
    ...(url === undefined ? {} : { $current_url: url }),
    site_key: config.siteKey,
    site_hostname: config.siteDomain,
  };
}

function emit(event: string, props?: AnalyticsProps): void {
  if (client === undefined) return;
  const properties = eventProperties(props);
  if (properties === undefined) return;
  client.capture(event, properties);
}

/** Fire a product-analytics event without allowing analytics to break UX. */
export function track(
  event: ScoutAnalyticsEvent,
  props?: AnalyticsProps,
): void {
  emit(event, props);
}

type NavigationClick = {
  preventDefault: () => void;
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

function emitThenFlush(
  event: ScoutAnalyticsEvent,
  props: AnalyticsProps | undefined,
  onFlushed: () => void,
): void {
  const properties = eventProperties(props);
  if (client !== undefined && properties !== undefined) {
    client.capture(event, properties, {
      send_instantly: true,
      transport: "sendBeacon",
    });
  }
  onFlushed();
}

export function trackOutboundClick(
  clickEvent: NavigationClick,
  event: ScoutAnalyticsEvent,
  href: string,
  props?: AnalyticsProps,
): void {
  if (
    !analyticsReady() ||
    clickEvent.defaultPrevented ||
    clickEvent.button !== 0 ||
    clickEvent.metaKey ||
    clickEvent.ctrlKey ||
    clickEvent.shiftKey ||
    clickEvent.altKey
  ) {
    emit(event, props);
    return;
  }
  clickEvent.preventDefault();
  emitThenFlush(event, props, () => {
    globalThis.location.href = href;
  });
}

/** Emit an event and wait for the unload-safe transport handoff. */
export function trackAndFlush(
  event: ScoutAnalyticsEvent,
  props?: AnalyticsProps,
): Promise<void> {
  return new Promise<void>((resolve) => {
    emitThenFlush(event, props, resolve);
  });
}

export function analyticsMeta(event: ScoutAnalyticsEvent): {
  analyticsEvent: ScoutAnalyticsEvent;
} {
  return { analyticsEvent: event };
}

const MutationMetaSchema = z.object({
  analyticsEvent: z.string().optional(),
});
const ResultKindSchema = z.object({ kind: z.string() });
const AddedFailedSchema = z.object({ added: z.number(), failed: z.number() });

/** Track a known React Query mutation result with a bounded outcome property. */
export function trackMutationMeta(
  meta: unknown,
  outcome: "success" | "error",
  data?: unknown,
): void {
  const parsed = MutationMetaSchema.safeParse(meta);
  if (!parsed.success) return;
  const event = parsed.data.analyticsEvent;
  if (event === undefined || !EVENT_SET.has(event)) return;
  if (outcome === "success") {
    const bulkResult = AddedFailedSchema.safeParse(data);
    if (bulkResult.success) {
      const result = bulkResult.data;
      emit(event, {
        outcome:
          result.failed === 0
            ? "success"
            : result.added === 0
              ? "error"
              : "partial",
      });
      return;
    }
    const result = ResultKindSchema.safeParse(data);
    if (result.success) {
      emit(event, { kind: result.data.kind });
      return;
    }
  }
  emit(event, { outcome });
}
