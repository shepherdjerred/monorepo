import { z } from "zod";

/**
 * Product-usage analytics for the app SPA, on top of the self-hosted Plausible
 * the marketing site already uses. Cookieless and privacy-first: we send only
 * low-cardinality enum props — never `discordId`, `guildId`, aliases, or Riot
 * IDs — and template dynamic route segments before reporting a pageview.
 *
 * Enabled only when `VITE_PLAUSIBLE_DOMAIN` is injected at site-release build
 * time (scripts/scout-site-release.ts): prod → `scout-for-lol.com`, beta →
 * `beta.scout-for-lol.com`. Absent in local dev, so everything here no-ops.
 * Mirrors the env-via-Zod pattern of `build-info.ts` and the lazy DOM access of
 * `discord-invite.ts` so this module stays importable from Bun unit tests.
 */
// Read the two optional overrides as plain strings, then normalize each field
// independently below. Keeping the object schema permissive (no per-field
// `.min(1)` that would fail the whole parse) means one malformed value can't
// discard the other: a stray empty `VITE_PLAUSIBLE_SRC` in a release
// environment must not throw away a valid `VITE_PLAUSIBLE_DOMAIN` and silently
// disable ALL telemetry.
const EnvSchema = z.object({
  VITE_PLAUSIBLE_DOMAIN: z.string().optional(),
  VITE_PLAUSIBLE_SRC: z.string().optional(),
});

// Treat empty/whitespace-only as absent so a blank override degrades only its
// own field (bad domain → analytics off; bad src → the default script).
function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}

// The manual variant disables Plausible's automatic pageview tracking so we
// control it ourselves — required because auto-tracking would record raw
// `/g/<guildId>/…` URLs (guild-id path cardinality + a weak PII leak).
const DEFAULT_SRC = "https://plausible.sjer.red/js/script.manual.js";

// BrowserRouter basename — the app is served under `/app`, so the browser's
// `location.pathname` carries this prefix that react-router's own pathname does
// not. Strip it before normalizing a raw browser path.
const BASENAME = "/app";

function readConfig(): { domain: string | undefined; src: string } {
  const parsed = EnvSchema.safeParse(import.meta.env);
  const env = parsed.success ? parsed.data : {};
  return {
    domain: nonEmpty(env.VITE_PLAUSIBLE_DOMAIN),
    src: nonEmpty(env.VITE_PLAUSIBLE_SRC) ?? DEFAULT_SRC,
  };
}

const config = readConfig();

/**
 * Every product-analytics event the app can emit. Names are stable
 * `snake_case` identifiers (they become Plausible goals). The single source of
 * truth — a runtime array so the reader can validate mutation meta against it.
 */
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

/** Low-cardinality props only — never PII / high-cardinality identifiers. */
export type AnalyticsProps = Record<string, string | number | boolean>;

type PlausibleOptions = {
  props?: AnalyticsProps;
  u?: string;
  callback?: () => void;
};

type PlausibleFn = {
  (event: string, options?: PlausibleOptions): void;
  // The queue the stub fills before the real script loads and flushes it.
  q?: unknown[];
};

declare global {
  var plausible: PlausibleFn | undefined;
}

let initialized = false;

/**
 * Install the standard Plausible queue stub so events fired before the deferred
 * script finishes loading (e.g. the initial pageview) are replayed, not lost.
 */
function installStub(): void {
  if (typeof globalThis.plausible === "function") return;
  const stub: PlausibleFn = (...args) => {
    (stub.q ??= []).push(args);
  };
  globalThis.plausible = stub;
}

/**
 * Load Plausible and arm the queue. No-op when unconfigured (local dev) or
 * already initialized. Call once at startup, before the first render.
 */
export function initAnalytics(): void {
  if (config.domain === undefined || initialized) return;
  if (typeof document === "undefined") return;
  initialized = true;
  installStub();
  const script = document.createElement("script");
  script.defer = true;
  // Bracket access: `dataset` is a DOMStringMap (index signature), and
  // noPropertyAccessFromIndexSignature forbids dot access here.
  script.dataset["domain"] = config.domain;
  script.src = config.src;
  document.head.append(script);
}

/**
 * Collapse dynamic route segments to templates so pageviews group by shape
 * (`/g/:guildId/reports/:reportId`) instead of exploding into one row per
 * guild/report/player. Static sibling routes (`new`, `help`, `edit`) are
 * preserved. Input is the react-router pathname (basename `/app` stripped).
 */
export function normalizePath(pathname: string): string {
  return pathname
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
}

/** Build the canonical, templated event URL for an already-normalized path. */
function pageUrl(domain: string, normalizedPath: string): string {
  return `https://${domain}/app${normalizedPath}`;
}

/**
 * The templated URL of the current page, for attaching to custom events. Plausible
 * defaults a custom event's URL to the live `document.URL`, which for dynamic
 * routes (`/g/<guildId>/players/<alias>`, report/competition routes, `/login`
 * with a raw `returnTo` query) would send the exact identifiers pageview
 * normalization exists to hide. Reading the browser path, stripping the basename,
 * normalizing, and dropping the query yields the same low-cardinality `u`
 * `trackPageview` sends. Returns undefined when analytics is off or off-DOM.
 */
function currentEventUrl(): string | undefined {
  const domain = config.domain;
  if (domain === undefined) return undefined;
  if (typeof document === "undefined") return undefined;
  const raw = globalThis.location.pathname;
  const path = raw.startsWith(BASENAME)
    ? raw.slice(BASENAME.length) || "/"
    : raw;
  return pageUrl(domain, normalizePath(path));
}

/** Report a templated SPA pageview. No-op when analytics is disabled. */
export function trackPageview(path: string): void {
  if (config.domain === undefined) return;
  const fn = globalThis.plausible;
  if (typeof fn !== "function") return;
  fn("pageview", { u: pageUrl(config.domain, path) });
}

function emit(
  event: string,
  props?: AnalyticsProps,
  callback?: () => void,
): void {
  const fn = globalThis.plausible;
  if (typeof fn !== "function") return;
  // Attach the templated current-page URL so custom events group by route shape
  // and never carry raw ids/queries (see currentEventUrl).
  const u = currentEventUrl();
  const options: PlausibleOptions = {};
  if (props !== undefined) options.props = props;
  if (u !== undefined) options.u = u;
  if (callback !== undefined) options.callback = callback;
  const hasOptions =
    props !== undefined || u !== undefined || callback !== undefined;
  fn(event, hasOptions ? options : undefined);
}

/**
 * Fire a product-analytics event. No-op when analytics is disabled. Never
 * throws — instrumentation must not be able to break a user action.
 */
export function track(
  event: ScoutAnalyticsEvent,
  props?: AnalyticsProps,
): void {
  emit(event, props);
}

// The subset of a mouse-click event this helper needs. React's
// `MouseEvent<HTMLAnchorElement>` is structurally assignable, so the analytics
// module stays framework-agnostic (importable from Bun unit tests) while the
// call sites pass their real React event.
type NavigationClick = {
  preventDefault: () => void;
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

/**
 * Track a funnel/entry event fired from an anchor that navigates away (Discord
 * login, bot install). A plain {@link track} can lose the event: before the
 * deferred Plausible script loads, the event only sits in the in-memory stub
 * queue, and the anchor's navigation tears that queue (or an in-flight request)
 * down before it flushes. Instead, intercept the click, fire with a Plausible
 * completion callback, and navigate on whichever comes first — the callback or a
 * short timeout — so the event gets its best chance to send without ever
 * blocking the user.
 *
 * Modified / non-primary clicks (open-in-new-tab, middle-click) and the
 * analytics-disabled case keep native navigation: the page isn't unloading, so a
 * fire-and-forget {@link track} is enough (or there's nothing to send).
 */
export function trackOutboundClick(
  clickEvent: NavigationClick,
  event: ScoutAnalyticsEvent,
  href: string,
  props?: AnalyticsProps,
): void {
  if (
    config.domain === undefined ||
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
  let navigated = false;
  const go = (): void => {
    if (navigated) return;
    navigated = true;
    globalThis.location.href = href;
  };
  emit(event, props, go);
  globalThis.setTimeout(go, 150);
}

/**
 * Build a React Query mutation `meta` that the global MutationCache tracks
 * automatically. Typed so a bad event name is a compile error at the call site.
 */
export function analyticsMeta(event: ScoutAnalyticsEvent): {
  analyticsEvent: ScoutAnalyticsEvent;
} {
  return { analyticsEvent: event };
}

const MutationMetaSchema = z.object({
  analyticsEvent: z.string().optional(),
});

// Many mutations resolve a discriminated-union result whose `kind` IS the
// business outcome (`removed` / `player-not-found`, `added` /
// `already-subscribed`, …). React Query reports every resolved value through
// onSuccess, so a flat `outcome: "success"` would record those resolved
// failures as successes — corrupting the usage data. When the result carries a
// string `kind`, report that instead.
const ResultKindSchema = z.object({ kind: z.string() });

/**
 * Fire the event carried by a mutation's `meta` (from {@link analyticsMeta}),
 * labeled by outcome. Validates the untyped React Query meta with Zod and drops
 * anything that isn't a known event, so a stray/typo'd value can't emit noise.
 *
 * On success, `data` is the resolved mutation result: if it's a discriminated
 * union with a `kind`, the event records `{ kind }` (the real business outcome)
 * rather than a blanket `{ outcome: "success" }`. Thrown errors (onError) always
 * record `{ outcome: "error" }`.
 */
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
    const result = ResultKindSchema.safeParse(data);
    if (result.success) {
      emit(event, { kind: result.data.kind });
      return;
    }
  }
  emit(event, { outcome });
}
