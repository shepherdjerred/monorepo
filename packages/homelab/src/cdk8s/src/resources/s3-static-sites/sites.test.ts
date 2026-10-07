import { describe, expect, test } from "vitest";
import { parseAllDocuments } from "yaml";
import { z } from "zod";

import { generateCaddyfile } from "@shepherdjerred/homelab/cdk8s/src/misc/s3-static-site.ts";
import { staticSites } from "./sites.ts";

describe("resume static site", () => {
  const resume = staticSites.find(
    ({ hostname }) => hostname === "resume.sjer.red",
  );
  if (resume === undefined) {
    throw new Error("resume.sjer.red static site is missing");
  }

  test("allows the page to embed its own PDF", () => {
    expect(resume.responseHeaders?.["X-Frame-Options"]).toBe("SAMEORIGIN");

    const caddyfile = generateCaddyfile({
      sites: [resume],
      s3Endpoint: "https://seaweedfs.example.test",
    });
    expect(caddyfile).toContain('X-Frame-Options "SAMEORIGIN"');
    expect(caddyfile).not.toContain('X-Frame-Options "DENY"');
  });
});

describe("Scout Storybook catalog site", () => {
  const catalog = staticSites.find(
    ({ hostname }) => hostname === "design.scout-for-lol.com",
  );
  if (catalog === undefined) {
    throw new Error("design.scout-for-lol.com static site is missing");
  }

  test("serves the dedicated bucket and probes the story preview", () => {
    expect(catalog.bucket).toBe("scout-design-system");
    expect(catalog.probes).toContainEqual({
      endpoint: "iframe",
      path: "/iframe.html",
    });
  });

  test("permits the same-origin preview iframe Storybook renders into", () => {
    // Both headers matter: the shared default is X-Frame-Options DENY, and the
    // other Scout sites' CSP sets frame-ancestors 'none'. Either one alone
    // would leave the catalog blank.
    expect(catalog.responseHeaders?.["X-Frame-Options"]).toBe("SAMEORIGIN");
    const csp = catalog.responseHeaders?.["Content-Security-Policy"];
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("frame-src 'self'");
  });

  test("talks to no third-party host", () => {
    const csp = catalog.responseHeaders?.["Content-Security-Policy"] ?? "";
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain("https://");
  });
});

describe("Scout static sites", () => {
  for (const hostname of [
    "scout-for-lol.com",
    "beta.scout-for-lol.com",
  ] as const) {
    test(`${hostname} permits Scout's required browser endpoints`, () => {
      const site = staticSites.find(
        (candidate) => candidate.hostname === hostname,
      );
      if (site === undefined) {
        throw new Error(`${hostname} static site is missing`);
      }
      const csp = site.responseHeaders?.["Content-Security-Policy"];
      expect(csp).toContain(
        "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://j.sjer.red https://s.pinimg.com https://www.redditstatic.com",
      );
      expect(csp).toContain(
        "img-src 'self' https://cdn.discordapp.com https://ddragon.leagueoflegends.com https://ct.pinterest.com data: blob:",
      );
      expect(csp).toContain(
        "connect-src 'self' https://j.sjer.red https://bugsink.sjer.red https://ct.pinterest.com https://pixel-config.reddit.com https://events.reddit.com",
      );
      expect(csp).toContain("frame-src https://ct.pinterest.com");
    });
  }

  test("beta serves Customs with Discord-only framing policy", () => {
    const beta = staticSites.find(
      (candidate) => candidate.hostname === "beta.scout-for-lol.com",
    );
    if (beta === undefined)
      throw new Error("beta Scout static site is missing");
    const customs = beta.spaFallbacks?.find(
      (fallback) => fallback.pathPrefix === "/customs/*",
    );
    expect(customs?.fallbackPath).toBe("/customs/index.html");
    expect(customs?.responseHeaders?.["X-Frame-Options"]).toBeNull();
    expect(customs?.responseHeaders?.["Content-Security-Policy"]).toContain(
      "frame-ancestors https://discord.com https://*.discord.com https://*.discordsays.com",
    );
    expect(beta.probes).toContainEqual({
      endpoint: "customs",
      module: "http_2xx",
      path: "/customs/",
    });
  });
});

describe("ScoutQL reference probes", () => {
  const routes = [
    ["scoutql-sources", "/docs/reference/scoutql-sources/"],
    ["scoutql-filters", "/docs/reference/scoutql-filters/"],
    ["scoutql-functions", "/docs/reference/scoutql-functions/"],
  ] as const;

  for (const hostname of [
    "scout-for-lol.com",
    "beta.scout-for-lol.com",
  ] as const) {
    test(`${hostname} probes ScoutQL reference pages`, () => {
      const site = staticSites.find(
        (candidate) => candidate.hostname === hostname,
      );
      if (site === undefined) {
        throw new Error(`${hostname} static site is missing`);
      }
      for (const [endpoint, path] of routes) {
        expect(site.probes).toContainEqual({
          endpoint,
          path,
          module: "http_200_no_redirect",
        });
      }
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
      "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://j.sjer.red",
    );
    expect(csp).toContain("connect-src 'self' https://j.sjer.red");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});

describe("Storm docs integration", () => {
  test("hands the apex route to the forum and retains static docs without DNS ownership", async () => {
    const ResourceSchema = z
      .object({
        kind: z.string(),
        metadata: z
          .object({ name: z.string(), namespace: z.string().optional() })
          .loose(),
      })
      .loose();
    const BindingSchema = ResourceSchema.extend({
      kind: z.literal("TunnelBinding"),
      subjects: z.array(
        z.object({ spec: z.object({ fqdn: z.string() }).loose() }).loose(),
      ),
      tunnelRef: z.object({ disableDNSUpdates: z.boolean() }).loose(),
    });
    const manifests = await Promise.all(
      ["s3-static-sites", "storm-forum"].map(async (name) => {
        const yaml = await Bun.file(
          new URL(`../../../dist/${name}.k8s.yaml`, import.meta.url),
        ).text();
        return parseAllDocuments(yaml).map((document) =>
          ResourceSchema.parse(document.toJSON()),
        );
      }),
    );
    const staticResources = manifests[0];
    if (!staticResources) throw new Error("Static-site manifests missing");
    expect(
      staticResources.map((resource) => resource.metadata.name),
    ).not.toContain("static-site-ts-mc-net");
    expect(
      staticResources.map((resource) => resource.metadata.name),
    ).not.toContain("s3-static-sites-tunnel-ts-mc-net");
    const bindings = manifests
      .flat()
      .filter((resource) => resource.kind === "TunnelBinding")
      .map((resource) => BindingSchema.parse(resource));
    const apexOwners = bindings.filter((binding) =>
      binding.subjects.some((subject) => subject.spec.fqdn === "ts-mc.net"),
    );
    expect(apexOwners.map((binding) => binding.metadata.namespace)).toEqual([
      "storm-forum",
    ]);
    expect(
      bindings.some(
        (binding) =>
          binding.metadata.namespace === "s3-static-sites" &&
          binding.subjects.some(
            (subject) => subject.spec.fqdn === "docs.ts-mc.net",
          ),
      ),
    ).toBe(true);
    expect(
      bindings.every((binding) => binding.tunnelRef.disableDNSUpdates),
    ).toBe(true);
  });

  test("allows the credentialed apex preference API without widening other connections", () => {
    const docs = staticSites.find(
      ({ hostname }) => hostname === "docs.ts-mc.net",
    );
    expect(docs?.responseHeaders?.["Content-Security-Policy"]).toContain(
      "connect-src 'self' https://j.sjer.red https://ts-mc.net;",
    );
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
