import { describe, expect, test } from "bun:test";
import { App, Chart } from "cdk8s";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { S3StaticSites } from "./s3-static-site.ts";

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
