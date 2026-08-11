import { afterEach, describe, expect, test } from "bun:test";
import type { CaptureOptions } from "posthog-js";
import {
  analyticsMeta,
  analyticsPrivacySettings,
  identifyUser,
  normalizePath,
  resetIdentity,
  setAnalyticsForTesting,
  setGuildContext,
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
  | { kind: "unregister"; property: string };

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

// Takes `config` positionally with no default: a default parameter would treat
// `install(undefined)` as "use TEST_CONFIG" and silently enable the client the
// disabled-path tests rely on being off.
function install(config: AnalyticsConfig | undefined): CapturedEvent[] {
  const calls: CapturedEvent[] = [];
  identityCalls = [];
  setAnalyticsForTesting(
    {
      capture(event, properties, options) {
        calls.push({ event, properties, options });
      },
      identify(distinctId) {
        identityCalls.push({ kind: "identify", distinctId });
      },
      reset() {
        identityCalls.push({ kind: "reset" });
      },
      register(properties) {
        identityCalls.push({ kind: "register", properties });
      },
      unregister(property) {
        identityCalls.push({ kind: "unregister", property });
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
      session_recording: { maskAllInputs: true },
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

describe("identity", () => {
  test("identifies once per Discord id", () => {
    installClient();
    identifyUser("160509172704739328");
    identifyUser("160509172704739328");
    expect(identityCalls).toEqual([
      { kind: "identify", distinctId: "160509172704739328" },
    ]);
  });

  test("re-identifies after a sign out resets the person", () => {
    installClient();
    identifyUser("160509172704739328");
    resetIdentity();
    identifyUser("160509172704739328");
    expect(identityCalls).toEqual([
      { kind: "identify", distinctId: "160509172704739328" },
      { kind: "reset" },
      { kind: "identify", distinctId: "160509172704739328" },
    ]);
  });

  test("registers and clears the guild super property", () => {
    installClient();
    setGuildContext("123456789012345678");
    setGuildContext(undefined);
    expect(identityCalls).toEqual([
      { kind: "register", properties: { guild_id: "123456789012345678" } },
      { kind: "unregister", property: "guild_id" },
    ]);
  });

  test("stays inert when PostHog never initialized", () => {
    setAnalyticsForTesting(undefined, undefined);
    identityCalls = [];
    identifyUser("160509172704739328");
    resetIdentity();
    setGuildContext("123456789012345678");
    expect(identityCalls).toEqual([]);
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
