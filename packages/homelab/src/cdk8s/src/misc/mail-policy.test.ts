import { describe, expect, test } from "vitest";
import { App, Chart } from "cdk8s";
import { z } from "zod";
import { parseAllDocuments } from "yaml";
import {
  domainRegistry,
  DomainRegistrySchema,
  mailPolicyBodyPattern,
  mailPolicyHosts,
  mailPolicyText,
} from "homelab/src/domain-registry.ts";
import { generateCaddyfile, S3StaticSites } from "./s3-static-site.ts";
import { BLACKBOX_MODULES } from "./probes/blackbox-modules.ts";

describe("Fastmail MTA-STS", () => {
  test("rejects unsafe policy targets, missing inventory, and disabled TLS", () => {
    expect(() =>
      DomainRegistrySchema.parse({ ...domainRegistry, domains: {} }),
    ).toThrow();
    expect(() =>
      DomainRegistrySchema.parse({
        ...domainRegistry,
        mailPolicy: { ...domainRegistry.mailPolicy, mx: ["attacker.example"] },
      }),
    ).toThrow();
    expect(() =>
      DomainRegistrySchema.parse({
        ...domainRegistry,
        domains: {
          "example.com": {
            fastmailReady: true,
            wildcardMail: true,
            tls13: "off",
            mtaStsPublished: false,
          },
        },
      }),
    ).toThrow();
  });

  test("serves the exact policy on dedicated hosts without redirects or buckets", () => {
    const caddyfile = generateCaddyfile({
      sites: [],
      mailPolicies: mailPolicyHosts,
      s3Endpoint: "https://s3.example.com",
    });
    for (const host of mailPolicyHosts) {
      expect(caddyfile).toContain(`http://${host.hostname} {`);
    }
    expect(caddyfile).toContain('Content-Type "text/plain; charset=utf-8"');
    expect(caddyfile).toContain(
      `respond \`${mailPolicyText(domainRegistry.mailPolicy)}\` 200`,
    );
    expect(caddyfile).toContain('respond "Not found" 404');
    expect(caddyfile).not.toContain("redir ");
    expect(caddyfile).not.toContain("bucket ");
  });

  test("probes reject redirects, error pages, and a changed MX policy", () => {
    const module = BLACKBOX_MODULES.mta_sts_policy;
    expect(module.http.valid_status_codes).toEqual([200]);
    expect(module.http.follow_redirects).toBe(false);
    const pattern = new RegExp(mailPolicyBodyPattern);
    const policy = mailPolicyText(domainRegistry.mailPolicy);
    expect(pattern.test(policy)).toBe(true);
    expect(pattern.test("<html>Cloudflare error</html>")).toBe(false);
    expect(pattern.test(policy.replace("mode: enforce", "mode: none"))).toBe(
      false,
    );
    expect(
      pattern.test(
        policy.replace("in2-smtp.messagingengine.com", "other.example.com"),
      ),
    ).toBe(false);
  });

  test("synthesizes every policy TunnelBinding and body-aware public Probe", () => {
    const app = new App();
    const chart = new Chart(app, "mail-policy", {
      namespace: "s3-static-sites",
    });
    new S3StaticSites(chart, "sites", {
      sites: [],
      mailPolicies: mailPolicyHosts,
      s3Endpoint: "https://s3.example.com",
      credentialsSecretName: "s3",
    });
    const manifest = z.looseObject({ kind: z.string() });
    const documents = parseAllDocuments(app.synthYaml()).map((doc) =>
      manifest.parse(doc.toJSON()),
    );
    const bindings = documents.filter((doc) => doc.kind === "TunnelBinding");
    const probes = documents.filter((doc) => doc.kind === "Probe");
    expect(bindings).toHaveLength(mailPolicyHosts.length);
    expect(probes).toHaveLength(mailPolicyHosts.length);
    for (const binding of bindings) {
      expect(
        z
          .object({
            tunnelRef: z.object({ disableDNSUpdates: z.literal(true) }),
          })
          .safeParse(binding).success,
      ).toBe(true);
    }
    for (const probe of probes) {
      expect(
        z
          .object({
            spec: z.object({
              module: z.literal("mta_sts_policy"),
              targets: z.object({
                staticConfig: z.object({
                  static: z.array(
                    z
                      .string()
                      .regex(
                        /^https:\/\/mta-sts\..+\/\.well-known\/mta-sts\.txt$/,
                      ),
                  ),
                }),
              }),
            }),
          })
          .safeParse(probe).success,
      ).toBe(true);
    }
  });
});
