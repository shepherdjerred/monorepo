import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("queues conversions and configures durable Scout analytics before PostHog loads", async () => {
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
  expect(window.posthog[0]).toEqual([
    "capture",
    "get_started_click",
    { cta_location: "home_hero" },
  ]);

  const config = window.posthog._i[0]?.[1];
  expect(config).toMatchObject({
    api_host: "https://us.i.posthog.com",
    asset_host: "https://us-assets.i.posthog.com",
    autocapture: true,
    capture_pageview: "history_change",
    capture_pageleave: true,
    capture_heatmaps: true,
    capture_dead_clicks: true,
    capture_performance: { web_vitals: true, network_timing: true },
    respect_dnt: true,
    person_profiles: "always",
    session_recording: { maskAllInputs: true },
    disable_session_recording: false,
  });

  // Durable visitor identity depends on these keys being ABSENT: `persistence:
  // "memory"` reset the distinct id on every page load, and `cookieless_mode`
  // made PostHog drop the events outright. `before_send` used to overwrite
  // `$current_url` with origin+pathname, which discarded campaign query strings.
  expect(config.persistence).toBeUndefined();
  expect(config.cookieless_mode).toBeUndefined();
  expect(config.before_send).toBeUndefined();
});
