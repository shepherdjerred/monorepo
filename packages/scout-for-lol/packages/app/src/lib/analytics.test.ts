import { afterEach, describe, expect, test } from "bun:test";
import type { CaptureOptions } from "posthog-js";
import {
  analyticsMeta,
  analyticsPrivacySettings,
  identifyUser,
  normalizePath,
  resetIdentity,
  setAnalyticsForTesting,
  analyticsContextRoute,
  clearGuildContext,
  resolveGuildContext,
  resolvedAnalyticsContextRoute,
  startAnalyticsCapture,
  stopAnalyticsCapture,
  syncAnalyticsIdentity,
  track,
  trackAndFlush,
  trackMutationMeta,
  trackOutboundClick,
  trackPageview,
  type AnalyticsConfig,
} from "#src/lib/analytics.ts";

type CapturedEvent = {
  event: string;
  properties: Record<string, string | number | boolean> | undefined;
  options: CaptureOptions | undefined;
};

type IdentityCall =
  | { kind: "identify"; distinctId: string }
  | { kind: "reset" }
  | { kind: "register"; properties: Record<string, string | number | boolean> }
  | {
      kind: "register_for_session";
      properties: Record<string, string | number | boolean>;
    }
  | { kind: "unregister_for_session"; property: string }
  | { kind: "opt_in" }
  | { kind: "opt_out" };

const TEST_CONFIG: AnalyticsConfig = {
  projectToken: "phc_test",
  apiHost: "https://us.i.posthog.com",
  assetHost: "https://us-assets.i.posthog.com",
  siteKey: "scout-beta",
  siteDomain: "beta.scout-for-lol.com",
  sessionReplay: true,
};

/** Identity calls from the most recent `installClient`/`installDisabledClient`. */
let identityCalls: IdentityCall[] = [];

// Mirrors the identity PostHog persists across page loads. The module under
// test keeps no identity state of its own, so this stand-in is the whole
// picture — and it is what lets a test reproduce a full-page navigation, where
// PostHog remembers a person the freshly-loaded module never saw.
let identified = false;
let distinctId = "anonymous-0";

// Takes `config` positionally with no default: a default parameter would treat
// `install(undefined)` as "use TEST_CONFIG" and silently enable the client the
// disabled-path tests rely on being off.
function install(config: AnalyticsConfig | undefined): CapturedEvent[] {
  const calls: CapturedEvent[] = [];
  identityCalls = [];
  identified = false;
  distinctId = "anonymous-0";
  setAnalyticsForTesting(
    {
      capture(event, properties, options) {
        calls.push({ event, properties, options });
      },
      identify(id) {
        identified = true;
        distinctId = id;
        identityCalls.push({ kind: "identify", distinctId: id });
      },
      reset() {
        identified = false;
        // PostHog mints a fresh anonymous id on reset; the new person must not
        // inherit the old one.
        distinctId = "anonymous-after-reset";
        identityCalls.push({ kind: "reset" });
      },
      isIdentified: () => identified,
      getDistinctId: () => distinctId,
      optInCapturing() {
        identityCalls.push({ kind: "opt_in" });
      },
      optOutCapturing() {
        identityCalls.push({ kind: "opt_out" });
      },
      register(properties) {
        identityCalls.push({ kind: "register", properties });
      },
      registerForSession(properties) {
        identityCalls.push({ kind: "register_for_session", properties });
      },
      unregisterForSession(property) {
        identityCalls.push({ kind: "unregister_for_session", property });
      },
    },
    config,
  );
  return calls;
}

function installClient(): CapturedEvent[] {
  return install(TEST_CONFIG);
}

function installDisabledClient(): CapturedEvent[] {
  return install(undefined);
}

function fakeClick(
  overrides: Partial<{
    defaultPrevented: boolean;
    button: number;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
  }> = {},
): {
  preventDefault: () => void;
  prevented: boolean;
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
} {
  return {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  };
}

afterEach(() => {
  setAnalyticsForTesting(undefined, undefined);
});

describe("normalizePath", () => {
  test("templates dynamic identifiers", () => {
    expect(normalizePath("/g/123456789012345678")).toBe("/g/:guildId");
    expect(normalizePath("/g/123/players/SomeAlias")).toBe(
      "/g/:guildId/players/:alias",
    );
    expect(normalizePath("/g/123/reports/45/edit")).toBe(
      "/g/:guildId/reports/:reportId/edit",
    );
    expect(normalizePath("/g/123/competitions/7")).toBe(
      "/g/:guildId/competitions/:competitionId",
    );
  });

  test("preserves known static routes and rejects unknown routes", () => {
    expect(normalizePath("/g/123/reports/new")).toBe("/g/:guildId/reports/new");
    expect(normalizePath("/g/123/reports/help")).toBe(
      "/g/:guildId/reports/help",
    );
    expect(normalizePath("/login")).toBe("/login");
    expect(normalizePath("/something/private")).toBe("/not-found");
  });
});

describe("privacy settings", () => {
  test("uses durable persistence, person profiles, and Scout replay", () => {
    const settings = analyticsPrivacySettings(TEST_CONFIG);
    expect(settings).toEqual({
      autocapture: true,
      capture_pageview: false,
      capture_pageleave: true,
      capture_heatmaps: true,
      capture_dead_clicks: true,
      capture_performance: { web_vitals: true, network_timing: true },
      respect_dnt: true,
      person_profiles: "always",
      mask_all_text: true,
      mask_all_element_attributes: true,
      session_recording: { maskAllInputs: true, maskTextSelector: "*" },
      disable_session_recording: false,
    });
    // A `persistence` override is what previously reset the distinct id on
    // every page load; the absence of the key is the fix, so assert it.
    expect(settings).not.toHaveProperty("persistence");
    expect(settings).not.toHaveProperty("cookieless_mode");
  });

  test("disables replay when the site registry says false", () => {
    expect(
      analyticsPrivacySettings({ ...TEST_CONFIG, sessionReplay: false })
        .disable_session_recording,
    ).toBe(true);
  });
});

// The server's opaque `analyticsUserId`, not a Discord snowflake — the distinct
// id is the durable join key for a person's events and recordings.
const ANALYTICS_USER_ID = "7316395a-b815-49d8-9794-9b56b3ce81c0";

/**
 * Reproduce a full-page navigation: PostHog still holds `id` from before, while
 * the module has no memory of it. Every identity bug in this file has lived in
 * that gap, so the tests have to be able to open it.
 */
function persistIdentity(id: string): void {
  identified = true;
  distinctId = id;
  identityCalls = [];
}

describe("identity", () => {
  test("identifies once per analytics user id", () => {
    installClient();
    identifyUser(ANALYTICS_USER_ID);
    identifyUser(ANALYTICS_USER_ID);
    expect(identityCalls).toEqual([
      { kind: "identify", distinctId: ANALYTICS_USER_ID },
    ]);
  });

  test("re-identifies after a sign out resets the person", () => {
    installClient();
    identifyUser(ANALYTICS_USER_ID);
    resetIdentity();
    identifyUser(ANALYTICS_USER_ID);
    expect(identityCalls).toEqual([
      { kind: "identify", distinctId: ANALYTICS_USER_ID },
      { kind: "reset" },
      { kind: "identify", distinctId: ANALYTICS_USER_ID },
    ]);
  });

  // Session-scoped, not durable: the workspace clears this from a React effect
  // cleanup that a closed tab never runs, so a durable super property would
  // outlive the visit in localStorage and mis-attribute the next one.
  test("scopes the guild super property to the session", () => {
    installClient();
    resolveGuildContext("/g/123456789012345678", "123456789012345678");
    clearGuildContext();
    expect(identityCalls).toEqual([
      {
        kind: "register_for_session",
        properties: { guild_id: "123456789012345678" },
      },
      { kind: "unregister_for_session", property: "guild_id" },
    ]);
  });

  // An anonymous visitor's distinct id must survive: resetting it on every
  // logged-out render is the unique-visitor regression this PR exists to fix.
  test("leaves an anonymous visitor's distinct id alone", () => {
    installClient();
    resetIdentity();
    expect(identityCalls).toEqual([]);
  });

  // The sign-out menu is only one way a session ends. An expired or revoked
  // cookie runs no handler, and after the reload module state is fresh while
  // PostHog still holds the previous person.
  test("resets an identity persisted from an earlier page load", () => {
    installClient();
    persistIdentity(ANALYTICS_USER_ID);
    resetIdentity();
    expect(identityCalls).toEqual([{ kind: "reset" }]);
  });

  // Switching accounts needs no logout: /login stays reachable while an old
  // session is valid, and the OAuth callback overwrites the cookie. After that
  // full-page return the module is fresh but PostHog still holds account A, so
  // identifying B straight over the top would alias the two into one person.
  test("resets before identifying a different person", () => {
    installClient();
    persistIdentity("account-a");
    identifyUser("account-b");
    expect(identityCalls).toEqual([
      { kind: "reset" },
      { kind: "identify", distinctId: "account-b" },
    ]);
  });

  // The mirror case: after a plain reload the module has no memory, but PostHog
  // already holds this exact person, so re-identifying would be a redundant
  // `$identify` on every cold load.
  test("does not re-identify the person PostHog already holds", () => {
    installClient();
    persistIdentity(ANALYTICS_USER_ID);
    identifyUser(ANALYTICS_USER_ID);
    expect(identityCalls).toEqual([]);
  });

  test("stays inert when PostHog never initialized", () => {
    setAnalyticsForTesting(undefined, undefined);
    identityCalls = [];
    identifyUser(ANALYTICS_USER_ID);
    resetIdentity();
    resolveGuildContext("/g/123456789012345678", "123456789012345678");
    startAnalyticsCapture();
    expect(identityCalls).toEqual([]);
  });
});

describe("syncAnalyticsIdentity", () => {
  // Session queries run with retries disabled, so a single transient failure
  // is permanent for the visit. Treating "no answer" as "signed out" would
  // reset a live identity and leave the rest of the visit anonymous while the
  // cookie is still perfectly valid.
  test("leaves a live identity alone when the session query has not succeeded", () => {
    installClient();
    persistIdentity(ANALYTICS_USER_ID);
    // A failed query and an in-flight one are indistinguishable here, and both
    // must be inert.
    syncAnalyticsIdentity({
      sessionResolved: false,
      analyticsUserId: undefined,
    });
    expect(identityCalls).toEqual([]);
  });

  test("resets only on a successful signed-out answer", () => {
    installClient();
    persistIdentity(ANALYTICS_USER_ID);
    syncAnalyticsIdentity({
      sessionResolved: true,
      analyticsUserId: undefined,
    });
    expect(identityCalls).toEqual([{ kind: "reset" }]);
  });

  test("identifies on a successful signed-in answer", () => {
    installClient();
    syncAnalyticsIdentity({
      sessionResolved: true,
      analyticsUserId: ANALYTICS_USER_ID,
    });
    expect(identityCalls).toEqual([
      { kind: "identify", distinctId: ANALYTICS_USER_ID },
    ]);
  });
});

describe("capture gate", () => {
  test("opens once, however many times it is asked", () => {
    installClient();
    startAnalyticsCapture();
    startAnalyticsCapture();
    expect(identityCalls).toEqual([{ kind: "opt_in" }]);
  });

  // `posthog.reset()` clears consent along with the person, and this app's
  // configured default is opted OUT. Without the re-opt-in, the first sign-out
  // or account switch after the gate opened would stop capture permanently and
  // silently for that browser — a far worse failure than the one the gate fixes.
  test("re-opts in after a reset that follows the gate opening", () => {
    installClient();
    startAnalyticsCapture();
    persistIdentity("account-a");
    resetIdentity();
    expect(identityCalls).toEqual([{ kind: "reset" }, { kind: "opt_in" }]);
  });

  test("an account switch after the gate opening also re-opts in", () => {
    installClient();
    startAnalyticsCapture();
    persistIdentity("account-a");
    identifyUser("account-b");
    expect(identityCalls).toEqual([
      { kind: "reset" },
      { kind: "opt_in" },
      { kind: "identify", distinctId: "account-b" },
    ]);
  });

  // The mirror: a reset during reconciliation, before the gate opens, must not
  // open it early — that is exactly the window the gate exists to keep shut.
  test("does not open the gate on a reset before it was opened", () => {
    installClient();
    persistIdentity("account-a");
    resetIdentity();
    expect(identityCalls).toEqual([{ kind: "reset" }]);
  });

  test("closes while context is unresolved and reopens after it settles", () => {
    installClient();
    startAnalyticsCapture();
    stopAnalyticsCapture();
    stopAnalyticsCapture();
    startAnalyticsCapture();
    expect(identityCalls).toEqual([
      { kind: "opt_in" },
      { kind: "opt_out" },
      { kind: "opt_in" },
    ]);
  });
});

describe("route analytics context", () => {
  test("identifies the routes that carry context beyond identity", () => {
    expect(analyticsContextRoute("/g/123")).toBe("/g/123");
    expect(analyticsContextRoute("/g/123/players/Someone")).toBe("/g/123");
    expect(analyticsContextRoute("/")).toBeUndefined();
    expect(analyticsContextRoute("/login")).toBeUndefined();
  });

  // Unresolved is the default, so a guild route is never ready on first render.
  // The gate reads this, and a pending answer must look different from "no
  // guild" — otherwise the entry pageview escapes before access resolves.
  test("reports no settled route until one resolves", () => {
    installClient();
    expect(resolvedAnalyticsContextRoute()).toBeUndefined();

    resolveGuildContext("/g/123", "123");
    expect(resolvedAnalyticsContextRoute()).toBe("/g/123");

    clearGuildContext();
    expect(resolvedAnalyticsContextRoute()).toBeUndefined();
  });

  // Access resolved but denied is a settled answer: the route becomes ready so
  // the pageview is not withheld forever, but no guild is attached.
  test("settles the route even when access is denied", () => {
    installClient();
    resolveGuildContext("/g/123", undefined);
    expect(resolvedAnalyticsContextRoute()).toBe("/g/123");
    expect(identityCalls).toEqual([
      { kind: "unregister_for_session", property: "guild_id" },
    ]);
  });
});

describe("track", () => {
  test("emits PostHog events with bounded properties and site identity", () => {
    const calls = installClient();
    track("ai_edit_applied");
    track("report_preset_used", { category: "Champions" });
    expect(calls).toEqual([
      {
        event: "ai_edit_applied",
        properties: {
          site_key: "scout-beta",
          site_hostname: "beta.scout-for-lol.com",
        },
        options: undefined,
      },
      {
        event: "report_preset_used",
        properties: {
          category: "Champions",
          site_key: "scout-beta",
          site_hostname: "beta.scout-for-lol.com",
        },
        options: undefined,
      },
    ]);
  });

  test("no-ops when PostHog configuration is absent", () => {
    const calls = installDisabledClient();
    track("login_click");
    expect(calls).toEqual([]);
  });
});

describe("trackPageview", () => {
  test("emits a normalized pageview without query strings or identifiers", () => {
    const calls = installClient();
    trackPageview("/g/123/reports/45");
    expect(calls).toEqual([
      {
        event: "$pageview",
        properties: {
          $current_url:
            "https://beta.scout-for-lol.com/app/g/:guildId/reports/:reportId",
          $pathname: "/app/g/:guildId/reports/:reportId",
          $host: "beta.scout-for-lol.com",
          site_key: "scout-beta",
          site_hostname: "beta.scout-for-lol.com",
        },
        options: undefined,
      },
    ]);
  });
});

describe("analyticsMeta + trackMutationMeta", () => {
  test("analyticsMeta wraps the event name", () => {
    expect(analyticsMeta("report_created")).toEqual({
      analyticsEvent: "report_created",
    });
  });

  test("records bounded mutation outcomes", () => {
    const calls = installClient();
    trackMutationMeta(analyticsMeta("report_created"), "success");
    trackMutationMeta(analyticsMeta("subscription_removed"), "success", {
      kind: "removed",
    });
    expect(
      calls.map(({ event, properties }) => ({ event, properties })),
    ).toEqual([
      {
        event: "report_created",
        properties: {
          outcome: "success",
          site_key: "scout-beta",
          site_hostname: "beta.scout-for-lol.com",
        },
      },
      {
        event: "subscription_removed",
        properties: {
          kind: "removed",
          site_key: "scout-beta",
          site_hostname: "beta.scout-for-lol.com",
        },
      },
    ]);
  });

  test("ignores absent and unknown-event metadata", () => {
    const calls = installClient();
    trackMutationMeta(undefined, "success");
    trackMutationMeta({}, "success");
    trackMutationMeta({ analyticsEvent: "not_a_real_event" }, "success");
    expect(calls).toEqual([]);
  });
});

describe("navigation capture", () => {
  test("keeps native navigation when analytics is disabled", () => {
    const calls = installDisabledClient();
    const click = fakeClick();
    trackOutboundClick(click, "login_click", "/api/auth/discord/start");
    expect(click.prevented).toBe(false);
    expect(calls).toEqual([]);
  });

  test("keeps native behavior for modified clicks", () => {
    const calls = installClient();
    const click = fakeClick({ metaKey: true });
    trackOutboundClick(click, "bot_install_click", "/api/discord/install");
    expect(click.prevented).toBe(false);
    expect(calls[0]?.event).toBe("bot_install_click");
  });

  test("uses PostHog's immediate beacon transport before programmatic navigation", async () => {
    const calls = installClient();
    await trackAndFlush("sign_out");
    expect(calls[0]?.options).toEqual({
      send_instantly: true,
      transport: "sendBeacon",
    });
  });
});
