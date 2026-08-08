import { afterEach, describe, expect, test } from "bun:test";
import {
  analyticsMeta,
  normalizePath,
  track,
  trackAndFlush,
  trackMutationMeta,
  trackOutboundClick,
  trackPageview,
} from "#src/lib/analytics.ts";

type MatomoCommand = readonly [string, ...unknown[]];

function installQueue(): unknown[][] {
  const calls: unknown[][] = [];
  globalThis._paq = {
    push(...commands: MatomoCommand[]) {
      calls.push(...commands.map((command) => [...command]));
      return calls.length;
    },
  };
  return calls;
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
  globalThis._paq = undefined;
});

describe("normalizePath", () => {
  test("templates the guild id", () => {
    expect(normalizePath("/g/123456789012345678")).toBe("/g/:guildId");
    expect(normalizePath("/g/123456789012345678/subscriptions")).toBe(
      "/g/:guildId/subscriptions",
    );
    expect(normalizePath("/g/123456789012345678/audit")).toBe(
      "/g/:guildId/audit",
    );
    expect(normalizePath("/g/123456789012345678/access")).toBe(
      "/g/:guildId/access",
    );
  });

  test("templates player alias, report id, and competition id", () => {
    expect(normalizePath("/g/123/players/SomeAlias")).toBe(
      "/g/:guildId/players/:alias",
    );
    expect(normalizePath("/g/123/reports/45")).toBe(
      "/g/:guildId/reports/:reportId",
    );
    expect(normalizePath("/g/123/reports/45/edit")).toBe(
      "/g/:guildId/reports/:reportId/edit",
    );
    expect(normalizePath("/g/123/competitions/7")).toBe(
      "/g/:guildId/competitions/:competitionId",
    );
    expect(normalizePath("/g/123/competitions/7/edit")).toBe(
      "/g/:guildId/competitions/:competitionId/edit",
    );
  });

  test("preserves static sibling routes", () => {
    expect(normalizePath("/g/123/reports/new")).toBe("/g/:guildId/reports/new");
    expect(normalizePath("/g/123/reports/help")).toBe(
      "/g/:guildId/reports/help",
    );
    expect(normalizePath("/g/123/competitions/new")).toBe(
      "/g/:guildId/competitions/new",
    );
  });

  test("passes static top-level routes through unchanged", () => {
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("/login")).toBe("/login");
    expect(normalizePath("/welcome")).toBe("/welcome");
    expect(normalizePath("/installed")).toBe("/installed");
  });
});

describe("track", () => {
  test("emits Matomo events and bounded custom dimensions", () => {
    const calls = installQueue();
    track("ai_edit_applied");
    track("report_preset_used", { category: "Champions" });
    expect(calls).toEqual([
      ["trackEvent", "scout", "ai_edit_applied"],
      ["setCustomDimension", 4, "Champions"],
      ["trackEvent", "scout", "report_preset_used"],
      ["deleteCustomDimension", 4],
    ]);
  });

  test("no-ops when Matomo is absent", () => {
    globalThis._paq = undefined;
    expect(() => track("login_click")).not.toThrow();
  });
});

describe("trackPageview", () => {
  test("does not send when the site build has no Matomo identity", () => {
    const calls = installQueue();
    trackPageview("/g/:guildId/reports");
    expect(calls).toEqual([]);
  });
});

describe("analyticsMeta + trackMutationMeta", () => {
  test("analyticsMeta wraps the event name", () => {
    expect(analyticsMeta("report_created")).toEqual({
      analyticsEvent: "report_created",
    });
  });

  test("fires the meta event with an outcome dimension", () => {
    const calls = installQueue();
    trackMutationMeta(analyticsMeta("report_created"), "success");
    trackMutationMeta(analyticsMeta("report_deleted"), "error");
    expect(calls).toEqual([
      ["setCustomDimension", 1, "success"],
      ["trackEvent", "scout", "report_created"],
      ["deleteCustomDimension", 1],
      ["setCustomDimension", 1, "error"],
      ["trackEvent", "scout", "report_deleted"],
      ["deleteCustomDimension", 1],
    ]);
  });

  test("records the discriminated result kind", () => {
    const calls = installQueue();
    trackMutationMeta(analyticsMeta("subscription_removed"), "success", {
      kind: "player-not-found",
    });
    trackMutationMeta(analyticsMeta("subscription_removed"), "success", {
      kind: "removed",
    });
    trackMutationMeta(analyticsMeta("subscription_removed"), "error", {
      kind: "removed",
    });
    expect(calls).toEqual([
      ["setCustomDimension", 3, "player-not-found"],
      ["trackEvent", "scout", "subscription_removed"],
      ["deleteCustomDimension", 3],
      ["setCustomDimension", 3, "removed"],
      ["trackEvent", "scout", "subscription_removed"],
      ["deleteCustomDimension", 3],
      ["setCustomDimension", 1, "error"],
      ["trackEvent", "scout", "subscription_removed"],
      ["deleteCustomDimension", 1],
    ]);
  });

  test("falls back to outcome when the result carries no kind", () => {
    const calls = installQueue();
    trackMutationMeta(analyticsMeta("player_account_added"), "success", {
      id: "abc",
    });
    trackMutationMeta(analyticsMeta("player_account_added"), "success");
    expect(calls).toEqual([
      ["setCustomDimension", 1, "success"],
      ["trackEvent", "scout", "player_account_added"],
      ["deleteCustomDimension", 1],
      ["setCustomDimension", 1, "success"],
      ["trackEvent", "scout", "player_account_added"],
      ["deleteCustomDimension", 1],
    ]);
  });

  test("no-ops on absent, empty, or unknown-event meta", () => {
    const calls = installQueue();
    trackMutationMeta(undefined, "success");
    trackMutationMeta({}, "success");
    trackMutationMeta({ analyticsEvent: "not_a_real_event" }, "success");
    expect(calls).toEqual([]);
  });
});

describe("trackOutboundClick", () => {
  test("keeps native navigation when analytics is disabled", () => {
    const calls = installQueue();
    const click = fakeClick();
    trackOutboundClick(click, "login_click", "/api/auth/discord/start");
    expect(click.prevented).toBe(false);
    expect(calls).toEqual([["trackEvent", "scout", "login_click"]]);
  });

  test("keeps native behavior for modified clicks", () => {
    const calls = installQueue();
    const click = fakeClick({ metaKey: true });
    trackOutboundClick(click, "bot_install_click", "/api/discord/install");
    expect(click.prevented).toBe(false);
    expect(calls).toEqual([["trackEvent", "scout", "bot_install_click"]]);
  });
});

describe("trackAndFlush", () => {
  test("emits and resolves immediately when analytics is disabled", async () => {
    const calls = installQueue();
    await trackAndFlush("sign_out");
    expect(calls).toEqual([["trackEvent", "scout", "sign_out"]]);
  });
});
