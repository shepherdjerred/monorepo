import { z } from "zod";

/**
 * Product-usage analytics for the app SPA, backed by self-hosted Matomo.
 * Cookieless and privacy-first: only bounded event properties are sent, and
 * dynamic route segments are templated before reporting a pageview or event.
 *
 * Site identity is injected by scripts/scout-site-release.ts for production
 * and beta builds. Local builds omit the variables and therefore do not send
 * pageviews; the queue-based event functions also no-op when no tracker queue
 * has been installed.
 */
const EnvSchema = z.object({
  VITE_MATOMO_SITE_ID: z.string().optional(),
  VITE_MATOMO_SITE_DOMAIN: z.string().optional(),
  VITE_MATOMO_SRC: z.string().optional(),
});

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}

const DEFAULT_SRC = "https://matomo.sjer.red/matomo.js";
const TRACKER_URL = "https://matomo.sjer.red/matomo.php";
const BASENAME = "/app";

function readConfig(): {
  siteId: string | undefined;
  siteDomain: string | undefined;
  src: string;
} {
  const parsed = EnvSchema.safeParse(import.meta.env);
  const env = parsed.success ? parsed.data : {};
  return {
    siteId: nonEmpty(env.VITE_MATOMO_SITE_ID),
    siteDomain: nonEmpty(env.VITE_MATOMO_SITE_DOMAIN),
    src: nonEmpty(env.VITE_MATOMO_SRC) ?? DEFAULT_SRC,
  };
}

const config = readConfig();

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
  "bot_install_click",
  "login_click",
  "sign_out",
  "theme_changed",
] as const;

export type ScoutAnalyticsEvent = (typeof SCOUT_ANALYTICS_EVENTS)[number];

const EVENT_SET: ReadonlySet<string> = new Set(SCOUT_ANALYTICS_EVENTS);

/** Only low-cardinality properties have a Matomo Custom Dimension. */
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

// These dimensions are configured in Matomo as event-scoped dimensions 1–8.
// Keeping the map exhaustive prevents arbitrary property names from becoming
// unbounded analytics dimensions or accidentally carrying identifiers.
const DIMENSION_IDS: Readonly<Record<string, number>> = {
  outcome: 1,
  reason: 2,
  kind: 3,
  category: 4,
  preference: 5,
  action: 6,
  step: 7,
  has_existing_query: 8,
};

type MatomoCommand = readonly [string, ...unknown[]];
type MatomoQueue = {
  push: (...commands: MatomoCommand[]) => number;
};

declare global {
  var _paq: MatomoQueue | undefined;
}

let initialized = false;

/** Install Matomo's queue before its deferred script loads. */
function installStub(): void {
  if (globalThis._paq !== undefined) return;
  const queue: MatomoCommand[] = [];
  globalThis._paq = queue;
}

/** Load Matomo and configure its privacy-preserving tracker. */
export function initAnalytics(): void {
  if (
    initialized ||
    config.siteId === undefined ||
    config.siteDomain === undefined
  ) {
    return;
  }
  if (typeof document === "undefined") return;
  initialized = true;
  installStub();
  const queue = globalThis._paq;
  if (queue === undefined) return;
  queue.push(["setTrackerUrl", TRACKER_URL]);
  queue.push(["setSiteId", config.siteId]);
  queue.push(["disableCookies"]);
  queue.push(["setDoNotTrack", true]);
  queue.push(["enableLinkTracking"]);

  const script = document.createElement("script");
  script.async = true;
  script.src = config.src;
  document.head.append(script);
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
  return `https://${siteDomain}/app${normalizedPath}`;
}

/** The normalized URL used for the current page's event context. */
function currentEventUrl(): string | undefined {
  const siteDomain = config.siteDomain;
  if (siteDomain === undefined || typeof document === "undefined") {
    return undefined;
  }
  const raw = globalThis.location.pathname;
  const path = raw.startsWith(BASENAME)
    ? raw.slice(BASENAME.length) || "/"
    : raw;
  return pageUrl(siteDomain, normalizePath(path));
}

function analyticsReady(): boolean {
  return (
    config.siteId !== undefined &&
    config.siteDomain !== undefined &&
    globalThis._paq !== undefined
  );
}

/** Report a templated SPA pageview. */
export function trackPageview(path: string): void {
  if (config.siteId === undefined || config.siteDomain === undefined) return;
  const queue = globalThis._paq;
  if (queue === undefined) return;
  queue.push(["setCustomUrl", pageUrl(config.siteDomain, path)]);
  if (typeof document === "object") {
    queue.push(["setDocumentTitle", document.title]);
  }
  queue.push(["trackPageView"]);
}

function emit(event: string, props?: AnalyticsProps): void {
  const queue = globalThis._paq;
  if (queue === undefined) return;

  const url = currentEventUrl();
  if (url !== undefined) queue.push(["setCustomUrl", url]);

  const dimensions: number[] = [];
  if (props !== undefined) {
    for (const [name, value] of Object.entries(props)) {
      const dimensionId = DIMENSION_IDS[name];
      if (dimensionId === undefined) continue;
      queue.push(["setCustomDimension", dimensionId, String(value)]);
      dimensions.push(dimensionId);
    }
  }

  queue.push(["trackEvent", "scout", event]);
  for (const dimensionId of dimensions) {
    queue.push(["deleteCustomDimension", dimensionId]);
  }
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

const FLUSH_TIMEOUT_MS = 150;

/**
 * Send an unload-safe event when a navigation is about to happen.
 *
 * The normal queue is sufficient once matomo.js has loaded, but an async
 * tracker script can still be pending when a user clicks a login or install
 * link. sendBeacon talks directly to Matomo in that case and lets the browser
 * finish the request while the document is being unloaded.
 */
function sendEventBeacon(
  event: string,
  props: AnalyticsProps | undefined,
): boolean {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.sendBeacon !== "function"
  ) {
    return false;
  }
  const doNotTrackSignals: unknown[] = [
    navigator.doNotTrack,
    typeof globalThis.window === "object"
      ? Reflect.get(globalThis.window, "doNotTrack")
      : undefined,
    Reflect.get(navigator, "msDoNotTrack"),
  ];
  if (
    doNotTrackSignals.some(
      (signal) => signal === "1" || signal === "yes" || signal === "true",
    )
  ) {
    return true;
  }
  if (config.siteId === undefined) return false;

  const body = new URLSearchParams({
    idsite: config.siteId,
    rec: "1",
    cookie: "0",
    e_c: "scout",
    e_a: event,
  });
  const url = currentEventUrl();
  if (url !== undefined) body.set("url", url);

  if (props !== undefined) {
    for (const [name, value] of Object.entries(props)) {
      const dimensionId = DIMENSION_IDS[name];
      if (dimensionId === undefined) continue;
      body.set(`dimension${String(dimensionId)}`, String(value));
    }
  }

  return navigator.sendBeacon(TRACKER_URL, body);
}

function emitThenFlush(
  event: string,
  props: AnalyticsProps | undefined,
  onFlushed: () => void,
): void {
  let flushed = false;
  const done = (): void => {
    if (flushed) return;
    flushed = true;
    onFlushed();
  };
  if (sendEventBeacon(event, props)) {
    done();
    return;
  }
  emit(event, props);
  globalThis.setTimeout(done, FLUSH_TIMEOUT_MS);
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

/** Emit an event and wait briefly before a programmatic navigation. */
export function trackAndFlush(
  event: ScoutAnalyticsEvent,
  props?: AnalyticsProps,
): Promise<void> {
  if (!analyticsReady()) {
    emit(event, props);
    return Promise.resolve();
  }
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
