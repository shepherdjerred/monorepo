import posthog, { type CaptureOptions } from "posthog-js";
import { z } from "zod";
import {
  ANALYTICS_EVENT_NAMES,
  type AnalyticsProps,
  type ScoutAnalyticsEvent,
} from "#src/lib/analytics-events.ts";

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
  /** The distinct id PostHog currently holds, identified or anonymous. */
  getDistinctId: () => string;
  /** Lift the opt-out PostHog is initialised with. */
  optInCapturing: () => void;
  /** Close the gate, overriding any opt-in this browser has stored. */
  optOutCapturing: () => void;
  register: (properties: PostHogProperties) => void;
  registerForSession: (properties: PostHogProperties) => void;
  unregisterForSession: (property: string) => void;
};

/** Super property carrying the active Discord guild. */
const GUILD_PROPERTY = "guild_id";

// Deliberately no module-level "who is identified" variable. PostHog's own
// persisted state is the single source of truth, because it is the only one
// that survives a full-page navigation — the OAuth round trip, a hard reload,
// a restored tab. A module variable is always empty on the next page load
// while PostHog still holds the previous person, and every identity bug in
// this file has been some version of those two disagreeing.
let config = readConfig();
let client: AnalyticsClient | undefined;
let initialized = false;

// PostHog starts opted out (see `initAnalytics`), so nothing — not autocapture,
// not a pageview — leaves the browser until the gate below opens. This flag is
// our own record of whether the gate has opened, which `resetPersistedIdentity`
// needs; PostHog's consent state is not a safe thing to infer it from, because
// `reset()` silently clears consent back to the opted-out default.
let captureEnabled = false;

// The route whose analytics context has settled, or undefined when none has.
// Unset is the safe default: a route that carries extra context is not ready
// until it says so, so no first render can slip an event out ahead of it.
let resolvedContextRoute: string | undefined;
const contextListeners = new Set<() => void>();

/** Inject a deterministic client/config in unit tests without module mocking. */
export function setAnalyticsForTesting(
  testClient: AnalyticsClient | undefined,
  testConfig: AnalyticsConfig | undefined,
): void {
  client = testClient;
  config = testConfig;
  initialized = false;
  captureEnabled = false;
  resolvedContextRoute = undefined;
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
  mask_all_text: true;
  mask_all_element_attributes: true;
  session_recording: { maskAllInputs: true; maskTextSelector: "*" };
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
    // Autocapture collects element `textContent` and attributes on its own, and
    // `maskTextSelector` below governs session replay only — it does nothing for
    // autocapture properties. The workspace renders player aliases as link text
    // and guild/player paths in `href`, so without these two flags every click
    // attached an alias and a URL to a durable person profile, which is exactly
    // what the bounded property registry forbids. Click and interaction counts
    // survive; only the identifying payload is dropped.
    mask_all_text: true,
    mask_all_element_attributes: true,
    // `person_profiles: "always"` ties every recording to an identified person,
    // and the workspace renders guild names, Discord display names, Riot
    // accounts, player aliases, and channel names as ordinary text — none of
    // which `maskAllInputs` covers, since it masks form values only. Masking
    // every text node keeps replay useful for layout, navigation, and rage or
    // dead clicks without turning it into a per-person record of who plays
    // with whom. A per-component allowlist was rejected: it fails open the
    // first time a new screen renders a name, which is the failure mode that
    // matters most here.
    session_recording: { maskAllInputs: true, maskTextSelector: "*" },
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
    // Nothing is captured until `startAnalyticsCapture` opens the gate. This is
    // the only lever that also holds back autocapture, which begins the moment
    // PostHog initialises and therefore cannot be fixed by ordering a
    // `capture()` call later. See `startAnalyticsCapture` for what has to be
    // true first.
    //
    // This flag alone is not enough — it is only consulted when the browser has
    // no stored consent decision, and the explicit `opt_out_capturing()` below
    // is what actually closes the gate on a return visit. It stays because it
    // covers the very first load, before any decision exists.
    opt_out_capturing_by_default: true,
    // Opting out must not take browser storage with it: the distinct id lives
    // there, and losing it per page load is the unique-visitor regression this
    // whole change set exists to fix. The default is already `false`; it is
    // written out because flipping it would silently undo that fix.
    opt_out_persistence_by_default: false,
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
    getDistinctId: () => posthog.get_distinct_id(),
    optInCapturing: () => {
      // `captureEventName: false` because opting in is our own gate opening,
      // not a consent action the user took that is worth an event.
      posthog.opt_in_capturing({ captureEventName: false });
    },
    optOutCapturing: () => {
      posthog.opt_out_capturing();
    },
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
  // `register_for_session` survives a full-page navigation in the same tab.
  // React never gets to run the previous workspace's cleanup in that case, so
  // clear the old guild before any context-free route can reopen capture.
  client.unregisterForSession(GUILD_PROPERTY);
  // Close the gate explicitly, every initialisation.
  //
  // `opt_out_capturing_by_default` is consulted only when the browser has no
  // stored consent decision. The first visit that reaches the gate persists an
  // opt-in, so on every later cold load PostHog honours that stored opt-in and
  // begins capturing immediately — which would leave the gate doing nothing for
  // exactly the returning visitors it exists to protect, the ones carrying a
  // persisted identity and guild that may both be stale.
  client.optOutCapturing();
}

/**
 * Bind the session to the signed-in user, deciding entirely from the identity
 * PostHog has persisted.
 *
 * Three cases, and the middle one is the reason this reads persisted state:
 *
 * - Already this person: do nothing, so repeated renders emit no redundant
 *   `$identify`.
 * - A **different** person: reset first. Switching accounts does not require a
 *   logout — signing in again from `/login` while an old session is still valid
 *   just overwrites the cookie — and after that full-page return, identifying
 *   straight over the top would alias the two accounts into one person.
 * - Anonymous: identify, which is the merge that gives a signed-in person their
 *   pre-login activity.
 *
 * Takes the server's opaque `analyticsUserId`, never a Discord snowflake. The
 * distinct id is the durable join key for a person's events and recordings, so
 * a Discord id here would make all of it addressable by Discord account — and
 * the analytics registry forbids sending Discord user ids in the first place.
 */
/**
 * `posthog.reset()` clears consent along with the person, returning the
 * instance to its configured default — and our default is opted **out**. A
 * reset after the gate has opened therefore stops capture permanently and
 * silently, for the life of that browser. Every reset goes through here so the
 * re-opt-in cannot be forgotten at a call site.
 */
function resetPersistedIdentity(activeClient: AnalyticsClient): void {
  activeClient.reset();
  if (captureEnabled) activeClient.optInCapturing();
}

export function identifyUser(analyticsUserId: string): void {
  const activeClient = client;
  if (activeClient === undefined) return;
  if (activeClient.isIdentified()) {
    if (activeClient.getDistinctId() === analyticsUserId) return;
    resetPersistedIdentity(activeClient);
  }
  activeClient.identify(analyticsUserId);
}

/**
 * Drop the identified person so a shared browser never merges two users.
 *
 * Safe to call on every anonymous render: `_isIdentified` reads PostHog's
 * persisted user state, so this resets exactly when an identity is still
 * attached — after an explicit sign-out and equally after an expired or revoked
 * cookie, where no logout handler ever runs. Resetting unconditionally would
 * mint a fresh distinct id for ordinary anonymous visitors, which is the
 * unique-visitor regression durable persistence exists to prevent.
 */
export function resetIdentity(): void {
  const activeClient = client;
  if (activeClient?.isIdentified() === true) {
    resetPersistedIdentity(activeClient);
  }
}

/**
 * Reconcile PostHog's identity with what the server says about this visitor.
 * This is the single place that decides, so every route goes through one rule.
 *
 * `sessionResolved` must be true **only** for a successful session response.
 * Loading and failure are both "we do not know yet", and neither is anonymous:
 * session queries run with retries disabled, so treating a transient error as
 * a signed-out answer would reset a live identity and leave the rest of the
 * visit anonymous even though the cookie is still valid.
 */
export function syncAnalyticsIdentity(session: {
  sessionResolved: boolean;
  analyticsUserId: string | undefined;
}): void {
  if (!session.sessionResolved) return;
  if (session.analyticsUserId === undefined) {
    resetIdentity();
    return;
  }
  identifyUser(session.analyticsUserId);
}

/**
 * The part of a path whose analytics context must resolve before this route may
 * emit anything, or undefined when the route carries no context beyond identity.
 *
 * Today that is only the guild workspace. A future route that registers its own
 * property belongs here too — that is what keeps the gate one rule rather than
 * a race rediscovered per screen.
 */
export function analyticsContextRoute(pathname: string): string | undefined {
  return /^\/g\/[^/]+/.exec(pathname)?.[0] ?? undefined;
}

/** Snapshot + subscription for `useSyncExternalStore` in the root layout. */
export function resolvedAnalyticsContextRoute(): string | undefined {
  return resolvedContextRoute;
}

export function subscribeAnalyticsContext(listener: () => void): () => void {
  contextListeners.add(listener);
  return () => {
    contextListeners.delete(listener);
  };
}

function notifyContextListeners(): void {
  for (const listener of contextListeners) listener();
}

/**
 * Attach the active guild to every subsequent event, autocapture and pageviews
 * included, and mark this route's context settled so the gate may open.
 *
 * Session-scoped, not durable: the clearing side of this lives in a React
 * effect cleanup, which a hard navigation or a closed tab never runs. A durable
 * super property would then survive in localStorage and attribute a later,
 * unrelated visit to the guild the user happened to leave open.
 *
 * `guildId` is undefined when access resolved but was denied — a settled answer,
 * not a pending one, so the route becomes ready with no guild attached.
 */
export function resolveGuildContext(
  routeKey: string,
  guildId: string | undefined,
): void {
  if (client !== undefined) {
    if (guildId === undefined) client.unregisterForSession(GUILD_PROPERTY);
    else client.registerForSession({ [GUILD_PROPERTY]: guildId });
  }
  resolvedContextRoute = routeKey;
  notifyContextListeners();
}

/** Leaving the workspace: drop the property and the readiness it granted. */
export function clearGuildContext(): void {
  client?.unregisterForSession(GUILD_PROPERTY);
  resolvedContextRoute = undefined;
  notifyContextListeners();
}

/**
 * Open the gate PostHog was initialised closed on.
 *
 * Callers must only reach this once identity has been reconciled and the
 * route's own context is attached, because everything before it is dropped
 * rather than mis-attributed — that is the trade this gate makes. Dropping a
 * handful of pre-consent autocapture events is the price of never recording a
 * pageview against the previous account or a guild the viewer cannot see.
 */
export function startAnalyticsCapture(): void {
  if (client === undefined || captureEnabled) return;
  captureEnabled = true;
  client.optInCapturing();
}

/** Whether product analytics can currently accept events. */
export function analyticsCaptureEnabled(): boolean {
  return captureEnabled;
}

/** Close the gate while session or route context is unresolved. */
export function stopAnalyticsCapture(): void {
  if (client === undefined || !captureEnabled) return;
  captureEnabled = false;
  client.optOutCapturing();
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
    )
    // Share token first, so the conversation rule's lookahead then sees the
    // already-templated `s` segment. The token is the share credential — it
    // is templated away before anything reaches PostHog.
    .replace(/^\/explore\/s\/[^/]+/, "/explore/s/:shareToken")
    .replace(/^\/explore\/(?!s(?:\/|$))[^/]+/, "/explore/:conversationId");
  const knownRoute =
    /^(?:\/|\/(?:login|welcome|installed)|\/explore(?:\/(?::conversationId|s\/:shareToken))?|\/g\/:guildId(?:\/(?:access|audit|subscriptions|players(?:\/:alias(?:\/manage)?)?|competitions(?:\/(?:new|:competitionId(?:\/edit)?))?|reports(?:\/(?:new|help|:reportId(?:\/edit)?))?)?)?)$/;
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
  if (event === undefined || !ANALYTICS_EVENT_NAMES.has(event)) return;
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
