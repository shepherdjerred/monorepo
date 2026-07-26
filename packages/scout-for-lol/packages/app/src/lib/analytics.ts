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
const EnvSchema = z.object({
  VITE_PLAUSIBLE_DOMAIN: z.string().min(1).optional(),
  VITE_PLAUSIBLE_SRC: z.string().min(1).optional(),
});

// The manual variant disables Plausible's automatic pageview tracking so we
// control it ourselves — required because auto-tracking would record raw
// `/g/<guildId>/…` URLs (guild-id path cardinality + a weak PII leak).
const DEFAULT_SRC = "https://plausible.sjer.red/js/script.manual.js";

function readConfig(): { domain: string | undefined; src: string } {
  const parsed = EnvSchema.safeParse(import.meta.env);
  const env = parsed.success ? parsed.data : {};
  return {
    domain: env.VITE_PLAUSIBLE_DOMAIN,
    src: env.VITE_PLAUSIBLE_SRC ?? DEFAULT_SRC,
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

/** Report a templated SPA pageview. No-op when analytics is disabled. */
export function trackPageview(path: string): void {
  if (config.domain === undefined) return;
  const fn = globalThis.plausible;
  if (typeof fn !== "function") return;
  fn("pageview", { u: `https://${config.domain}/app${path}` });
}

function emit(event: string, props?: AnalyticsProps): void {
  const fn = globalThis.plausible;
  if (typeof fn !== "function") return;
  fn(event, props === undefined ? undefined : { props });
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

/**
 * Fire the event carried by a mutation's `meta` (from {@link analyticsMeta}),
 * labeled by outcome. Validates the untyped React Query meta with Zod and drops
 * anything that isn't a known event, so a stray/typo'd value can't emit noise.
 */
export function trackMutationMeta(
  meta: unknown,
  outcome: "success" | "error",
): void {
  const parsed = MutationMetaSchema.safeParse(meta);
  if (!parsed.success) return;
  const event = parsed.data.analyticsEvent;
  if (event === undefined || !EVENT_SET.has(event)) return;
  emit(event, { outcome });
}
