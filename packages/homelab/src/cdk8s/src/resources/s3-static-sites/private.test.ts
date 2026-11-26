import { App } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { createS3StaticSitesChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/s3-static-sites.ts";
import { privateShareCaddyfile } from "./private.ts";

const ResourceSchema = z
  .object({
    kind: z.string(),
    metadata: z.object({ name: z.string() }).loose(),
  })
  .loose();

function resources() {
  const app = new App();
  createS3StaticSitesChart(app);
  return parseAllDocuments(app.synthYaml()).map((document) =>
    ResourceSchema.parse(document.toJSON()),
  );
}

function named(kind: string, name: string) {
  const found = resources().find(
    (resource) => resource.kind === kind && resource.metadata.name === name,
  );
  if (found === undefined) throw new Error(`${kind} ${name} not rendered`);
  return found;
}

describe("the tailnet-only share gateway", () => {
  test("serves the bucket from the root of any host, with no redirect and no tunnel", () => {
    const caddyfile = privateShareCaddyfile();
    expect(caddyfile).toContain(":8080 {");
    expect(caddyfile).toContain("index index.html");
    expect(caddyfile).toContain("bucket {$S3_BUCKET}");
    // Shared files have extensionless keys, so a trailing-slash redirect
    // would break them; and no host matcher, as the proxy forwards the
    // tailnet name.
    expect(caddyfile).not.toContain("redir");
    expect(caddyfile).not.toContain("http://");
    expect(caddyfile).not.toContain("reverse_proxy");

    const kinds = resources().map((resource) => resource.kind);
    // The one Ingress is the tailnet one: no second tunnel binding appears
    // for the private host.
    expect(
      resources().filter(
        (resource) =>
          resource.kind === "TunnelBinding" &&
          JSON.stringify(resource).includes("private"),
      ),
    ).toEqual([]);
    expect(kinds).toContain("Ingress");
  });

  test("names its bucket literally and takes the shared S3 credentials", () => {
    const deployment = named("Deployment", "s3-static-sites-private");
    const text = JSON.stringify(deployment["spec"]);
    expect(text).toContain('"name":"S3_BUCKET","value":"private-sjer-red"');
    expect(text).toContain("seaweedfs-s3-credentials");
  });

  test("its policy admits only Tailscale and the probe, and reaches only DNS and SeaweedFS", () => {
    const policy = z
      .object({
        spec: z.object({
          podSelector: z.object({
            matchLabels: z.record(z.string(), z.string()),
          }),
          ingress: z.array(z.unknown()),
          egress: z.array(z.unknown()),
        }),
      })
      .parse(named("NetworkPolicy", "s3-static-sites-private-netpol"));
    expect(policy.spec.podSelector.matchLabels).toEqual({
      app: "s3-static-sites-private",
    });
    const ingress = JSON.stringify(policy.spec.ingress);
    expect(ingress).toContain('"kubernetes.io/metadata.name":"tailscale"');
    expect(ingress).toContain('"kubernetes.io/metadata.name":"prometheus"');
    expect(ingress).not.toContain("cloudflare");
    expect(policy.spec.egress).toHaveLength(2);
    const egress = JSON.stringify(policy.spec.egress);
    expect(egress).toContain("kube-dns");
    expect(egress).toContain("seaweedfs");
    expect(egress).not.toContain("scout");
  });

  test("the public pod's policy selects only the public pod", () => {
    const policy = named("NetworkPolicy", "s3-static-sites-netpol");
    expect(JSON.stringify(policy["spec"])).toContain(
      '"podSelector":{"matchLabels":{"app":"s3-static-sites"}},"policyTypes"',
    );
    const public_ = named("Deployment", "s3-static-sites");
    expect(JSON.stringify(public_["spec"])).toContain(
      '"app":"s3-static-sites"',
    );
  });
});
