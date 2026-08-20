import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("keeps marketing capture closed until the Scout session is reconciled", async () => {
  const source = await readFile(
    new URL("public/posthog-bootstrap.js", import.meta.url),
    "utf8",
  );
  const insertedScripts = [];

  class HTMLScriptElement {
    dataset = {};
  }

  const currentScript = new HTMLScriptElement();
  currentScript.dataset = {
    posthogProjectToken: "phc_test",
    posthogApiHost: "https://us.i.posthog.com",
    posthogAssetHost: "https://us-assets.i.posthog.com",
    posthogSiteKey: "scout-beta",
    posthogSiteDomain: "beta.scout-for-lol.com",
    posthogSessionReplay: "true",
  };
  const firstScript = {
    parentNode: {
      insertBefore(script) {
        insertedScripts.push(script);
      },
    },
  };
  const document = {
    currentScript,
    createElement() {
      return {};
    },
    getElementsByTagName() {
      return [firstScript];
    },
  };
  const window = {
    fetchCalls: [],
    async fetch(url, options) {
      this.fetchCalls.push({ url, options });
      return {
        ok: true,
        async json() {
          return { result: { data: { user: null } } };
        },
      };
    },
    location: {
      origin: "https://beta.scout-for-lol.com",
      pathname: "/getting-started",
    },
  };

  vm.runInNewContext(source, {
    Array,
    HTMLScriptElement,
    document,
    window,
  });

  expect(insertedScripts).toHaveLength(1);
  expect(insertedScripts[0]?.src).toBe(
    "https://us-assets.i.posthog.com/static/array.js",
  );
  expect(typeof window.posthog.capture).toBe("function");

  window.posthog.capture("get_started_click", { cta_location: "home_hero" });
  expect(window.posthog[0]).toEqual(["opt_out_capturing"]);
  expect(window.posthog[1]).toEqual([
    "capture",
    "get_started_click",
    { cta_location: "home_hero" },
  ]);

  const config = window.posthog._i[0]?.[1];
  expect(config).toMatchObject({
    api_host: "https://us.i.posthog.com",
    asset_host: "https://us-assets.i.posthog.com",
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    capture_performance: false,
    respect_dnt: true,
    person_profiles: "always",
    session_recording: { maskAllInputs: true, maskTextSelector: "*" },
    mask_all_text: true,
    mask_all_element_attributes: true,
    disable_session_recording: true,
    opt_out_capturing_by_default: true,
    opt_out_persistence_by_default: false,
  });

  let identified = true;
  const reconciliationCalls = [];
  await config.loaded({
    opt_out_capturing() {
      reconciliationCalls.push({ kind: "opt_out" });
    },
    unregister_for_session(property) {
      reconciliationCalls.push({ kind: "unregister_for_session", property });
    },
    _isIdentified() {
      return identified;
    },
    get_distinct_id() {
      return "stale-app-user";
    },
    reset() {
      identified = false;
      reconciliationCalls.push({ kind: "reset" });
    },
    identify(analyticsUserId) {
      reconciliationCalls.push({ kind: "identify", analyticsUserId });
    },
    register(properties) {
      reconciliationCalls.push({ kind: "register", properties });
    },
    set_config(nextConfig) {
      reconciliationCalls.push({ kind: "set_config", config: nextConfig });
    },
    opt_in_capturing(options) {
      reconciliationCalls.push({ kind: "opt_in", options });
    },
  });

  expect(window.fetchCalls).toEqual([
    {
      url: "/trpc/auth.sessionState",
      options: {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      },
    },
  ]);
  expect(reconciliationCalls).toEqual([
    { kind: "opt_out" },
    { kind: "unregister_for_session", property: "guild_id" },
    {
      kind: "set_config",
      config: {
        autocapture: true,
        capture_pageview: "history_change",
        capture_pageleave: true,
        capture_heatmaps: true,
        capture_dead_clicks: true,
        capture_performance: { web_vitals: true, network_timing: true },
        session_recording: { maskAllInputs: true, maskTextSelector: "*" },
        mask_all_text: true,
        mask_all_element_attributes: true,
        disable_session_recording: false,
      },
    },
    { kind: "reset" },
    { kind: "unregister_for_session", property: "guild_id" },
    {
      kind: "register",
      properties: {
        site_key: "scout-beta",
        site_hostname: "beta.scout-for-lol.com",
      },
    },
    { kind: "opt_in", options: { captureEventName: false } },
  ]);

  // Durable visitor identity depends on these keys being ABSENT: `persistence:
  // "memory"` reset the distinct id on every page load, and `cookieless_mode`
  // made PostHog drop the events outright. `before_send` used to overwrite
  // `$current_url` with origin+pathname, which discarded campaign query strings.
  expect(config.persistence).toBeUndefined();
  expect(config.cookieless_mode).toBeUndefined();
  expect(config.before_send).toBeUndefined();
});
