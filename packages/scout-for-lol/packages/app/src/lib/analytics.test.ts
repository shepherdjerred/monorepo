import { afterEach, describe, expect, test } from "bun:test";
import {
  analyticsMeta,
  normalizePath,
  track,
  trackMutationMeta,
  trackPageview,
} from "#src/lib/analytics.ts";

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
