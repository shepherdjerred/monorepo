import { describe, expect, test } from "vitest";

import { staticSites } from "./sites.ts";
import { renderHeaderBlock } from "@shepherdjerred/homelab/cdk8s/src/misc/s3-static-site.ts";

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

describe("Scout Customs Activity sites", () => {
  for (const hostname of [
    "customs.scout-for-lol.com",
    "customs-beta.scout-for-lol.com",
  ] as const) {
    test(`${hostname} is Discord-embeddable without weakening Scout hosts`, () => {
      const site = staticSites.find(
        (candidate) => candidate.hostname === hostname,
      );
      if (site === undefined)
        throw new Error(`${hostname} static site is missing`);
      expect(site.indexFile).toBe("customs/index.html");
      expect(site.notFoundPage).toBe("customs/index.html");
      expect(site.responseHeaders?.["X-Frame-Options"]).toBeNull();
      expect(site.responseHeaders?.["Content-Security-Policy"]).toContain(
        "frame-ancestors https://discord.com https://*.discord.com",
      );
      expect(site.responseHeaders?.["Content-Security-Policy"]).not.toContain(
        "posthog",
      );
      expect(renderHeaderBlock(site.responseHeaders)).toContain(
        "-X-Frame-Options",
      );
    });
  }

  test("existing Scout hosts remain non-embeddable", () => {
    for (const hostname of ["scout-for-lol.com", "beta.scout-for-lol.com"]) {
      const site = staticSites.find(
        (candidate) => candidate.hostname === hostname,
      );
      if (site === undefined)
        throw new Error(`${hostname} static site is missing`);
      expect(site.responseHeaders?.["Content-Security-Policy"]).toContain(
        "frame-ancestors 'none'",
      );
      expect(site.responseHeaders?.["X-Frame-Options"]).toBeUndefined();
      expect(renderHeaderBlock(site.responseHeaders)).toContain(
        'X-Frame-Options "DENY"',
      );
    }
  });
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
