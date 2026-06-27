import { describe, expect, it, test } from "bun:test";
import { App, Chart } from "cdk8s";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import {
  generateCaddyfile,
  renderHeaderBlock,
  S3StaticSites,
} from "./s3-static-site.ts";

const ProbeSchema = z.object({
  apiVersion: z.literal("monitoring.coreos.com/v1"),
  kind: z.literal("Probe"),
  metadata: z.object({
    name: z.string(),
  }),
  spec: z.object({
    jobName: z.string(),
    module: z.string(),
    targets: z.object({
      staticConfig: z.object({
        labels: z.record(z.string(), z.string()),
        static: z.array(z.string()),
      }),
    }),
  }),
});

function synthesizeStaticSites() {
  const app = new App();
  const chart = new Chart(app, "test", {
    namespace: "s3-static-sites",
  });

  new S3StaticSites(chart, "s3-static-sites", {
    credentialsSecretName: "seaweedfs-s3-credentials",
    s3Endpoint: "https://seaweedfs.sjer.red",
    sites: [
      {
        hostname: "sjer.red",
        bucket: "sjer-red",
        probes: [{ endpoint: "rss", path: "/rss.xml", module: "rss_2xx" }],
      },
    ],
  });

  return app.synthYaml();
}

function parseDocuments(yamlContent: string): unknown[] {
  return yamlContent
    .split(/^---$/m)
    .map((document) => document.trim())
    .filter((document) => document.length > 0)
    .map((document) => parseYaml(document));
}

describe("S3StaticSites probes", () => {
  test("generates an RSS-aware probe for sjer.red/rss.xml", () => {
    const probes = parseDocuments(synthesizeStaticSites())
      .map((document) => ProbeSchema.safeParse(document))
      .filter((result) => result.success)
      .map((result) => result.data);

    const rssProbe = probes.find(
      (probe) => probe.metadata.name === "static-site-sjer-red-rss",
    );

    expect(rssProbe).toBeDefined();
    expect(rssProbe?.spec.jobName).toBe("static-site-sjer.red-rss");
    expect(rssProbe?.spec.module).toBe("rss_2xx");
    expect(rssProbe?.spec.targets.staticConfig.static).toEqual([
      "https://sjer.red/rss.xml",
    ]);
    expect(rssProbe?.spec.targets.staticConfig.labels).toEqual({
      endpoint: "rss",
      path: "/rss.xml",
      site: "sjer.red",
    });
  });

  test("throws when two probes share an endpoint name", () => {
    expect(() =>
      synthesizeWithProbes([
        { endpoint: "feed", path: "/rss.xml", module: "rss_2xx" },
        { endpoint: "feed", path: "/atom.xml", module: "rss_2xx" },
      ]),
    ).toThrow(/Duplicate probe endpoint 'feed'/);
  });

  test("throws when a user-provided probe reuses the reserved 'root' endpoint", () => {
    expect(() =>
      synthesizeWithProbes([{ endpoint: "root", path: "/sitemap.xml" }]),
    ).toThrow(/Duplicate probe endpoint 'root'/);
  });
});

function synthesizeWithProbes(
  probes: { endpoint: string; path: `/${string}`; module?: string }[],
) {
  const app = new App();
  const chart = new Chart(app, "test", { namespace: "s3-static-sites" });
  new S3StaticSites(chart, "s3-static-sites", {
    credentialsSecretName: "seaweedfs-s3-credentials",
    s3Endpoint: "https://seaweedfs.sjer.red",
    sites: [
      {
        hostname: "sjer.red",
        bucket: "sjer-red",
        probes,
      },
    ],
  });
  app.synthYaml();
}

const baseProps = {
  sites: [
    { hostname: "example.test", bucket: "example" },
    { hostname: "two.example.test", bucket: "second" },
  ],
  s3Endpoint: "https://s3.example.test",
};

describe("generateCaddyfile", () => {
  const out = generateCaddyfile(baseProps);

  it("emits a global block with s3proxy ordering and no auto_https", () => {
    expect(out).toContain("order s3proxy last");
    expect(out).toContain("auto_https off");
  });

  it("emits a per-site block for every configured site", () => {
    expect(out).toContain("http://example.test {");
    expect(out).toContain("http://two.example.test {");
  });

  it("redirects directory-style paths to include a trailing slash", () => {
    expect(out).toContain("@noTrailingSlash path_regexp ^/[^.]*[^/]$");
    expect(out).toContain("redir @noTrailingSlash {uri}/ 301");
  });

  it("configures s3proxy with bucket, endpoint, region, index, and 404 page", () => {
    expect(out).toContain("bucket example");
    expect(out).toContain("bucket second");
    expect(out).toContain("index index.html");
    expect(out).toContain("errors 404 404.html");
    expect(out).toContain("endpoint {$S3_ENDPOINT:https://s3.example.test}");
    expect(out).toContain("region {$S3_REGION:us-east-1}");
    expect(out).toContain("force_path_style");
  });

  it("does NOT strip conditional headers (relies on caddy-s3-proxy fork that handles 304 natively)", () => {
    // These were workarounds for lindenlab/caddy-s3-proxy#63 — removed once
    // the fork supports HEAD natively and surfaces 304s from index lookups.
    // Keeping them would force RSS readers and browsers to re-download the
    // full body on every poll instead of getting a cheap 304.
    expect(out).not.toContain("request_header -If-Modified-Since");
    expect(out).not.toContain("request_header -If-None-Match");
  });

  it("honors a per-site indexFile override", () => {
    const custom = generateCaddyfile({
      sites: [
        { hostname: "custom.test", bucket: "custom", indexFile: "main.html" },
      ],
      s3Endpoint: "https://s3.example.test",
    });
    expect(custom).toContain("index main.html");
    expect(custom).not.toContain("index index.html");
  });

  it("honors a per-site notFoundPage override", () => {
    const custom = generateCaddyfile({
      sites: [
        {
          hostname: "custom.test",
          bucket: "custom",
          notFoundPage: "missing.html",
        },
      ],
      s3Endpoint: "https://s3.example.test",
    });
    expect(custom).toContain("errors 404 missing.html");
    expect(custom).not.toContain("errors 404 404.html");
  });

  it("uses the explicit s3Region when provided", () => {
    const custom = generateCaddyfile({
      ...baseProps,
      s3Region: "us-west-2",
    });
    expect(custom).toContain("region {$S3_REGION:us-west-2}");
    expect(custom).not.toContain("region {$S3_REGION:us-east-1}");
  });

  it("accepts pre-scheme hostnames without re-prefixing", () => {
    const custom = generateCaddyfile({
      sites: [{ hostname: "https://secure.test", bucket: "secure" }],
      s3Endpoint: "https://s3.example.test",
    });
    expect(custom).toContain("https://secure.test {");
    expect(custom).not.toContain("http://https://secure.test");
  });

  describe("spaFallbacks", () => {
    it("emits a per-prefix s3proxy with overridden 404 fallback", () => {
      const caddyfile = generateCaddyfile({
        sites: [
          {
            hostname: "spa.test",
            bucket: "spa",
            spaFallbacks: [
              { pathPrefix: "/app/*", fallbackPath: "/app/index.html" },
            ],
          },
        ],
        s3Endpoint: "https://s3.example.test",
      });
      expect(caddyfile).toContain("handle /app/* {");
      // Inside the /app/* handle: s3proxy with /app/index.html fallback
      expect(caddyfile).toContain("errors 404 /app/index.html");
      // Fall-through site-wide s3proxy keeps default 404 page
      expect(caddyfile).toContain("errors 404 404.html");
    });

    it("renders /app/* spa fallback BEFORE the catch-all handle", () => {
      const caddyfile = generateCaddyfile({
        sites: [
          {
            hostname: "spa.test",
            bucket: "spa",
            spaFallbacks: [
              { pathPrefix: "/app/*", fallbackPath: "/app/index.html" },
            ],
          },
        ],
        s3Endpoint: "https://s3.example.test",
      });
      const spaIdx = caddyfile.indexOf("handle /app/*");
      const fallthroughIdx = caddyfile.indexOf("\thandle {");
      expect(spaIdx).toBeGreaterThan(-1);
      expect(fallthroughIdx).toBeGreaterThan(-1);
      expect(spaIdx).toBeLessThan(fallthroughIdx);
    });
  });
});

describe("generateCaddyfile reverseProxies", () => {
  it("emits a handle block per reverse-proxy entry", () => {
    const caddyfile = generateCaddyfile({
      sites: [
        {
          hostname: "app.test",
          bucket: "app",
          reverseProxies: [
            { path: "/trpc*", upstream: "backend.app.svc:3000" },
            { path: "/api/*", upstream: "backend.app.svc:3000" },
          ],
        },
      ],
      s3Endpoint: "https://s3.example.test",
    });
    expect(caddyfile).toContain("handle /trpc* {");
    expect(caddyfile).toContain("handle /api/* {");
    expect(caddyfile).toContain("reverse_proxy backend.app.svc:3000");
  });

  it("includes lb_policy + lb_try_duration so backend rollouts don't 502", () => {
    const caddyfile = generateCaddyfile({
      sites: [
        {
          hostname: "app.test",
          bucket: "app",
          reverseProxies: [
            { path: "/api/*", upstream: "backend.app.svc:3000" },
          ],
        },
      ],
      s3Endpoint: "https://s3.example.test",
    });
    expect(caddyfile).toContain("lb_policy round_robin");
    expect(caddyfile).toContain("lb_try_duration 5s");
  });

  it("emits a rewrite directive when rewriteTo is set", () => {
    const caddyfile = generateCaddyfile({
      sites: [
        {
          hostname: "app.test",
          bucket: "app",
          reverseProxies: [
            {
              path: "/api/healthz",
              upstream: "backend.app.svc:3000",
              rewriteTo: "/healthz",
            },
          ],
        },
      ],
      s3Endpoint: "https://s3.example.test",
    });
    expect(caddyfile).toContain("handle /api/healthz {");
    expect(caddyfile).toContain("rewrite * /healthz");
  });

  it("emits rewriteTo entries before non-rewriting entries so /api/healthz isn't shadowed by /api/*", () => {
    const caddyfile = generateCaddyfile({
      sites: [
        {
          hostname: "app.test",
          bucket: "app",
          reverseProxies: [
            // Intentionally in the wrong order — generator must reorder
            { path: "/api/*", upstream: "backend.app.svc:3000" },
            {
              path: "/api/healthz",
              upstream: "backend.app.svc:3000",
              rewriteTo: "/healthz",
            },
          ],
        },
      ],
      s3Endpoint: "https://s3.example.test",
    });
    const healthzIdx = caddyfile.indexOf("handle /api/healthz");
    const apiIdx = caddyfile.indexOf("handle /api/* {");
    expect(healthzIdx).toBeGreaterThan(-1);
    expect(apiIdx).toBeGreaterThan(-1);
    expect(healthzIdx).toBeLessThan(apiIdx);
  });

  it("keeps the fall-through s3proxy block after handle blocks", () => {
    const caddyfile = generateCaddyfile({
      sites: [
        {
          hostname: "app.test",
          bucket: "app",
          reverseProxies: [
            { path: "/api/*", upstream: "backend.app.svc:3000" },
          ],
        },
      ],
      s3Endpoint: "https://s3.example.test",
    });
    const handleIdx = caddyfile.indexOf("handle /api/*");
    const s3Idx = caddyfile.indexOf("s3proxy {");
    expect(handleIdx).toBeGreaterThan(-1);
    expect(s3Idx).toBeGreaterThan(handleIdx);
  });

  it("does not emit handle blocks for sites without reverseProxies", () => {
    const caddyfile = generateCaddyfile({
      sites: [{ hostname: "static.test", bucket: "static" }],
      s3Endpoint: "https://s3.example.test",
    });
    expect(caddyfile).not.toContain("reverse_proxy");
    expect(caddyfile).toContain("s3proxy {");
  });

  it("sorts entries by path length descending — narrow paths without rewriteTo also win", () => {
    // Regression: previously the sort used `rewriteTo !== undefined` as a
    // specificity proxy. A narrow path without rewriteTo would NOT win over
    // a broader prefix. Now sorts by literal path length descending.
    const caddyfile = generateCaddyfile({
      sites: [
        {
          hostname: "app.test",
          bucket: "app",
          reverseProxies: [
            // Intentionally in the wrong order — generator must reorder
            { path: "/api/*", upstream: "backend.app.svc:3000" },
            // Narrow path WITHOUT rewriteTo — must still come first
            { path: "/api/status", upstream: "backend.app.svc:3000" },
          ],
        },
      ],
      s3Endpoint: "https://s3.example.test",
    });
    const statusIdx = caddyfile.indexOf("handle /api/status");
    const apiIdx = caddyfile.indexOf("handle /api/* {");
    expect(statusIdx).toBeGreaterThan(-1);
    expect(apiIdx).toBeGreaterThan(-1);
    expect(statusIdx).toBeLessThan(apiIdx);
  });

  it("excludes reverse-proxy and spa-fallback paths from the @noTrailingSlash redirect matcher", () => {
    // Regression: without this exclusion, `redir` fires before any `handle`
    // block (redir has a lower Caddy directive ordinal), 301-ing
    // /api/healthz → /api/healthz/ and bypassing the rewrite-to-/healthz
    // transform on the way to the backend.
    const caddyfile = generateCaddyfile({
      sites: [
        {
          hostname: "app.test",
          bucket: "app",
          reverseProxies: [
            {
              path: "/api/healthz",
              upstream: "backend.app.svc:3000",
              rewriteTo: "/healthz",
            },
            { path: "/api/*", upstream: "backend.app.svc:3000" },
          ],
          spaFallbacks: [
            { pathPrefix: "/app/*", fallbackPath: "/app/index.html" },
          ],
        },
      ],
      s3Endpoint: "https://s3.example.test",
    });
    expect(caddyfile).toContain("@noTrailingSlash {");
    expect(caddyfile).toContain("not path /api/healthz /api/* /app/*");
  });

  it("emits the bare path_regexp matcher when a site has no proxies or fallbacks", () => {
    const caddyfile = generateCaddyfile({
      sites: [{ hostname: "static.test", bucket: "static" }],
      s3Endpoint: "https://s3.example.test",
    });
    expect(caddyfile).toContain("@noTrailingSlash path_regexp ^/[^.]*[^/]$");
    expect(caddyfile).not.toContain("not path");
  });
});

const DeploymentSchema = z.object({
  kind: z.literal("Deployment"),
  spec: z.object({
    template: z.object({
      metadata: z.object({
        annotations: z.record(z.string(), z.string()).optional(),
      }),
    }),
  }),
});

function synthAnnotation(
  sites: { hostname: string; bucket: string }[],
): string | undefined {
  const app = new App();
  const chart = new Chart(app, "test", { namespace: "s3-static-sites" });
  new S3StaticSites(chart, "s3-static-sites", {
    credentialsSecretName: "seaweedfs-s3-credentials",
    s3Endpoint: "https://seaweedfs.sjer.red",
    sites,
  });
  const docs = parseDocuments(app.synthYaml());
  for (const doc of docs) {
    const parsed = DeploymentSchema.safeParse(doc);
    if (parsed.success) {
      return parsed.data.spec.template.metadata.annotations?.["caddyfile-hash"];
    }
  }
  return undefined;
}

describe("response headers", () => {
  it("renders defense-in-depth defaults plus -Server in every site block", () => {
    const out = generateCaddyfile({
      sites: [{ hostname: "static.test", bucket: "static" }],
      s3Endpoint: "https://s3.example.test",
    });
    expect(out).toContain(`Strict-Transport-Security "max-age=31536000"`);
    expect(out).toContain(`X-Content-Type-Options "nosniff"`);
    expect(out).toContain(`X-Frame-Options "DENY"`);
    expect(out).toContain(`Referrer-Policy "strict-origin-when-cross-origin"`);
    expect(out).toContain(
      `Permissions-Policy "camera=(), microphone=(), geolocation=(), interest-cohort=()"`,
    );
    expect(out).toContain("-Server");
  });

  it("renders the header block BEFORE the redirect/handle directives", () => {
    const out = generateCaddyfile({
      sites: [{ hostname: "static.test", bucket: "static" }],
      s3Endpoint: "https://s3.example.test",
    });
    const headerIdx = out.indexOf("header {");
    const redirIdx = out.indexOf("redir @noTrailingSlash");
    expect(headerIdx).toBeGreaterThan(-1);
    expect(redirIdx).toBeGreaterThan(headerIdx);
  });

  it("lets a site override a default header value", () => {
    const block = renderHeaderBlock({
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    });
    expect(block).toContain(
      `Strict-Transport-Security "max-age=31536000; includeSubDomains"`,
    );
    expect(block).not.toContain(
      `Strict-Transport-Security "max-age=31536000"\n`,
    );
  });

  it("lets a site add a non-default header (e.g. CSP)", () => {
    const block = renderHeaderBlock({
      "Content-Security-Policy": "default-src 'self'",
    });
    expect(block).toContain(`Content-Security-Policy "default-src 'self'"`);
    // Defaults still present.
    expect(block).toContain(`X-Frame-Options "DENY"`);
  });

  it("lets a site delete a default header by setting it to null", () => {
    const block = renderHeaderBlock({ "X-Frame-Options": null });
    expect(block).toContain("-X-Frame-Options");
    expect(block).not.toContain(`X-Frame-Options "DENY"`);
  });

  it("escapes backslashes and double quotes in header values", () => {
    const block = renderHeaderBlock({
      "X-Test-Header": String.raw`value with "quote" and \backslash`,
    });
    expect(block).toContain(
      String.raw`X-Test-Header "value with \"quote\" and \\backslash"`,
    );
  });
});

describe("S3StaticSites pod-template hash annotation", () => {
  test("renders a caddyfile-hash annotation on the pod template", () => {
    const hash = synthAnnotation([{ hostname: "a.test", bucket: "a" }]);
    expect(hash).toBeDefined();
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
  });

  test("hash changes when the site list changes (forces pod rollout)", () => {
    const a = synthAnnotation([{ hostname: "a.test", bucket: "a" }]);
    const b = synthAnnotation([{ hostname: "b.test", bucket: "b" }]);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a).not.toBe(b);
  });
});
