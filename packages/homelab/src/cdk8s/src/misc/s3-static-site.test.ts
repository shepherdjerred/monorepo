import { describe, expect, it, test } from "bun:test";
import { App, Chart } from "cdk8s";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { generateCaddyfile, S3StaticSites } from "./s3-static-site.ts";

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
});

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
});
