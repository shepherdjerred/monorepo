import { afterEach, describe, expect, test } from "bun:test";
import {
  analyticsMeta,
  normalizePath,
  track,
  trackMutationMeta,
  trackOutboundClick,
  trackPageview,
} from "#src/lib/analytics.ts";

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
  globalThis.plausible = undefined;
});

describe("normalizePath", () => {
  test("templates the guild id", () => {
    expect(normalizePath("/g/123456789012345678")).toBe("/g/:guildId");
    expect(normalizePath("/g/123456789012345678/subscriptions")).toBe(
      "/g/:guildId/subscriptions",
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

  test("preserves static sibling routes (new / help)", () => {
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
  test("forwards event + props to plausible when present", () => {
    const calls: [string, unknown][] = [];
    globalThis.plausible = (event, options) => {
      calls.push([event, options]);
    };
    track("ai_edit_applied");
    track("report_preset_used", { category: "Champions" });
    expect(calls).toEqual([
      ["ai_edit_applied", undefined],
      ["report_preset_used", { props: { category: "Champions" } }],
    ]);
  });

  test("no-ops (never throws) when plausible is absent", () => {
    globalThis.plausible = undefined;
    expect(() => {
      track("login_click");
    }).not.toThrow();
  });
});

describe("trackPageview", () => {
  test("no-ops when analytics is disabled (no domain in this build)", () => {
    // The test build injects no VITE_PLAUSIBLE_DOMAIN, so pageviews must not
    // fire even if a plausible function is present.
    const calls: string[] = [];
    globalThis.plausible = (event) => {
      calls.push(event);
    };
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

  test("fires the meta's event with the outcome", () => {
    const calls: [string, unknown][] = [];
    globalThis.plausible = (event, options) => {
      calls.push([event, options]);
    };
    trackMutationMeta(analyticsMeta("report_created"), "success");
    trackMutationMeta(analyticsMeta("report_deleted"), "error");
    expect(calls).toEqual([
      ["report_created", { props: { outcome: "success" } }],
      ["report_deleted", { props: { outcome: "error" } }],
    ]);
  });

  test("records the discriminated result kind instead of a blanket success", () => {
    const calls: [string, unknown][] = [];
    globalThis.plausible = (event, options) => {
      calls.push([event, options]);
    };
    // A resolved business failure must not be recorded as `outcome: "success"`.
    trackMutationMeta(analyticsMeta("subscription_removed"), "success", {
      kind: "player-not-found",
    });
    trackMutationMeta(analyticsMeta("subscription_removed"), "success", {
      kind: "removed",
    });
    // A thrown error always records `outcome: "error"`, ignoring any data.
    trackMutationMeta(analyticsMeta("subscription_removed"), "error", {
      kind: "removed",
    });
    expect(calls).toEqual([
      ["subscription_removed", { props: { kind: "player-not-found" } }],
      ["subscription_removed", { props: { kind: "removed" } }],
      ["subscription_removed", { props: { outcome: "error" } }],
    ]);
  });

  test("falls back to outcome when the result carries no kind", () => {
    const calls: [string, unknown][] = [];
    globalThis.plausible = (event, options) => {
      calls.push([event, options]);
    };
    trackMutationMeta(analyticsMeta("player_account_added"), "success", {
      id: "abc",
    });
    trackMutationMeta(analyticsMeta("player_account_added"), "success");
    expect(calls).toEqual([
      ["player_account_added", { props: { outcome: "success" } }],
      ["player_account_added", { props: { outcome: "success" } }],
    ]);
  });

  test("no-ops on absent, empty, or unknown-event meta", () => {
    const calls: string[] = [];
    globalThis.plausible = (event) => {
      calls.push(event);
    };
    trackMutationMeta(undefined, "success");
    trackMutationMeta({}, "success");
    trackMutationMeta({ analyticsEvent: "not_a_real_event" }, "success");
    expect(calls).toEqual([]);
  });
});

describe("trackOutboundClick", () => {
  test("emits without preventing native navigation when analytics is disabled", () => {
    // No VITE_PLAUSIBLE_DOMAIN in the test build, so the click keeps default
    // behavior (the browser navigates) and the event fires fire-and-forget.
    const calls: [string, unknown][] = [];
    globalThis.plausible = (event, options) => {
      calls.push([event, options]);
    };
    const click = fakeClick();
    trackOutboundClick(click, "login_click", "/api/auth/discord/start");
    expect(click.prevented).toBe(false);
    expect(calls).toEqual([["login_click", undefined]]);
  });

  test("keeps native behavior for modified clicks (open-in-new-tab)", () => {
    const calls: [string, unknown][] = [];
    globalThis.plausible = (event, options) => {
      calls.push([event, options]);
    };
    const click = fakeClick({ metaKey: true });
    trackOutboundClick(click, "bot_install_click", "/api/discord/install");
    expect(click.prevented).toBe(false);
    expect(calls).toEqual([["bot_install_click", undefined]]);
  });
});
