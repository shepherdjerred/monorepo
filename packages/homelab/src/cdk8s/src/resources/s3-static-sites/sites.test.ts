import { describe, expect, test } from "bun:test";

import { staticSites } from "./sites.ts";

describe("Scout static sites", () => {
  for (const hostname of [
    "scout-for-lol.com",
    "beta.scout-for-lol.com",
  ] as const) {
    test(`${hostname} permits only the PostHog US endpoints`, () => {
      const site = staticSites.find(
        (candidate) => candidate.hostname === hostname,
      );
      if (site === undefined) {
        throw new Error(`${hostname} static site is missing`);
      }
      const csp = site.responseHeaders?.["Content-Security-Policy"];
      expect(csp).toContain(
        "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://us-assets.i.posthog.com",
      );
      expect(csp).toContain("connect-src 'self' https://us.i.posthog.com");
    });
  }
});

describe("human wiki static site", () => {
  const wiki = staticSites.find(({ hostname }) => hostname === "wiki.sjer.red");
  if (wiki === undefined) {
    throw new Error("wiki.sjer.red static site is missing");
  }

  test("serves the dedicated bucket and probes the sitemap", () => {
    expect(wiki.bucket).toBe("wiki-sjer-red");
    expect(wiki.probes).toContainEqual({
      endpoint: "sitemap",
      module: "http_2xx",
      path: "/sitemap-index.xml",
    });
  });

  test("allows Pagefind, Mermaid, and PostHog Cloud US", () => {
    const csp = wiki.responseHeaders?.["Content-Security-Policy"];
    expect(csp).toContain(
      "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://us-assets.i.posthog.com",
    );
    expect(csp).toContain("connect-src 'self' https://us.i.posthog.com");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});

describe("Scout static sites", () => {
  for (const hostname of ["scout-for-lol.com", "beta.scout-for-lol.com"]) {
    test(`${hostname} probes the docs entrypoint`, () => {
      const site = staticSites.find(
        (candidate) => candidate.hostname === hostname,
      );
      if (site === undefined) {
        throw new Error(`${hostname} static site is missing`);
      }

      expect(site.probes).toContainEqual({
        endpoint: "docs",
        module: "http_2xx",
        path: "/docs/",
      });
      expect(site.responseHeaders?.["Content-Security-Policy"]).toContain(
        "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
      );
    });
  }
});
