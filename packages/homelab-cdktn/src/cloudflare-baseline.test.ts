import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { CloudflareProvider } from "#generated/providers/cloudflare/provider/index.ts";
import { HttpProvider } from "#generated/providers/http/provider/index.ts";
import { DomainBaseline } from "#src/stacks/cloudflare/domain-baseline.ts";
import type { DomainBaselineProps } from "#src/stacks/cloudflare/domain-baseline.ts";
import { StaticCache } from "#src/stacks/cloudflare/static-cache.ts";
import { synthesizeStack } from "#src/testing.ts";

/**
 * The baseline's conditions, on the JSON OpenTofu reads. These are the cases
 * the HCL module's `tofu test` file covered; the module decided them at plan
 * time from its variables, the construct decides them at synthesis.
 */

const ZONE_ID = "d4036b55fca60ca5f998866309e951d8";
const POLICY =
  "version: STSv1\nmode: enforce\nmx: in1-smtp.messagingengine.com\nmx: in2-smtp.messagingengine.com\nmax_age: 86400\n";

const DEFAULTS: DomainBaselineProps = {
  domain: "example.com",
  zoneId: ZONE_ID,
  resourcePrefix: "example_com",
  fastmailReady: true,
  wildcardMail: true,
  tls13: "on",
  mtaStsPublished: false,
  ctAlertRecipient: "root@sjer.red",
  mailPolicy: {
    version: "STSv1",
    mode: "enforce",
    mx: ["in1-smtp.messagingengine.com", "in2-smtp.messagingengine.com"],
    maxAge: 86_400,
  },
  tunnelTarget: "tunnel.example.net",
};

async function baseline(overrides: Partial<DomainBaselineProps> = {}) {
  let relocations: DomainBaseline["relocations"] = [];
  const stack = await synthesizeStack((scope) => {
    new CloudflareProvider(scope, "cloudflare");
    new HttpProvider(scope, "http");
    const construct = new DomainBaseline(scope, { ...DEFAULTS, ...overrides });
    construct.moveIntoRoot(scope);
    ({ relocations } = construct);
  });
  const of = (type: string) => stack.resource?.[type] ?? {};
  return {
    stack,
    relocations,
    records: of("cloudflare_dns_record"),
    alerting: of("cloudflare_ct_alerting"),
    settings: of("cloudflare_zone_setting"),
    recipients: of("terraform_data"),
    policies: stack.data?.["http"] ?? {},
  };
}

const names = (resources: Record<string, unknown>) =>
  Object.keys(resources).toSorted();

describe("domain baseline", () => {
  test("bootstrap provisions the policy host without advertising enforcement or reading a live endpoint", async () => {
    const { records, policies } = await baseline();
    expect(records["example_com_baseline_mta_sts"]).toBeUndefined();
    expect(policies).toEqual({});
    // The host is unconditional: Caddy can serve the policy before discovery.
    expect(records["example_com_baseline_mta_sts_host"]).toEqual({
      zone_id: ZONE_ID,
      ttl: 1,
      name: "mta-sts",
      type: "CNAME",
      content: "tunnel.example.net",
      proxied: true,
    });
  });

  test("certificate monitoring delivers to the owned inbox and replaces on a recipient change", async () => {
    const { alerting, recipients } = await baseline();
    expect(alerting).toEqual({
      example_com_baseline_ct: {
        zone_id: ZONE_ID,
        enabled: true,
        emails: ["root@sjer.red"],
        lifecycle: {
          create_before_destroy: true,
          replace_triggered_by: [
            "terraform_data.example_com_baseline_ct_recipient",
          ],
        },
      },
    });
    expect(recipients).toEqual({
      example_com_baseline_ct_recipient: { triggers_replace: "root@sjer.red" },
    });
  });

  test("an adopted alert keeps the recipients Cloudflare already holds", async () => {
    const { alerting, recipients } = await baseline({ ctAlertRecipient: null });
    expect(alerting).toEqual({
      example_com_baseline_ct_existing: {
        zone_id: ZONE_ID,
        enabled: true,
        lifecycle: { ignore_changes: ["emails"] },
      },
    });
    expect(recipients).toEqual({});
    await expect(
      baseline({ ctAlertRecipient: "one@example.com, two@example.com" }),
    ).rejects.toThrow("Use a single email address");
  });

  test("a domain Fastmail has not confirmed advertises no mail routing and authorizes no outbound mail", async () => {
    const { records } = await baseline({ fastmailReady: false });
    expect(names(records).filter((name) => name.includes("_mx_"))).toEqual([]);
    expect(records["example_com_baseline_spf"]?.["content"]).toBe(
      "v=spf1 -all",
    );
    // Prepared DKIM selectors deploy before account-side activation.
    expect(
      names(records).filter((name) => name.includes("_dkim_")),
    ).toHaveLength(3);

    const ready = await baseline();
    expect(ready.records["example_com_baseline_spf"]?.["content"]).toBe(
      "v=spf1 include:spf.messagingengine.com -all",
    );
    expect(
      names(ready.records).filter((name) => name.includes("_mx_")),
    ).toEqual([
      "example_com_baseline_mx_primary",
      "example_com_baseline_mx_secondary",
      "example_com_baseline_wildcard_mx_primary",
      "example_com_baseline_wildcard_mx_secondary",
    ]);
    expect(ready.records["example_com_baseline_wildcard_mx_secondary"]).toEqual(
      {
        zone_id: ZONE_ID,
        ttl: 1,
        name: "*",
        type: "MX",
        content: "in2-smtp.messagingengine.com",
        priority: 20,
      },
    );
    const apexOnly = await baseline({ wildcardMail: false });
    expect(
      names(apexOnly.records).filter((name) => name.includes("_mx_")),
    ).toEqual([
      "example_com_baseline_mx_primary",
      "example_com_baseline_mx_secondary",
    ]);
  });

  test("the discovery revision identifies the exact served policy", async () => {
    const { records, policies } = await baseline({ mtaStsPublished: true });
    expect(policies).toEqual({
      example_com_baseline_mail_policy: {
        url: "https://mta-sts.example.com/.well-known/mta-sts.txt",
        request_timeout_ms: 10_000,
      },
    });
    const revision = createHash("sha256")
      .update(POLICY)
      .digest("hex")
      .slice(0, 16);
    const discovery = records["example_com_baseline_mta_sts"];
    expect(discovery).toMatchObject({
      zone_id: ZONE_ID,
      ttl: 1,
      name: "_mta-sts",
      type: "TXT",
      content: `v=STSv1; id=${revision}`,
    });
    // The plan fails unless the endpoint answers 200 with exactly the policy
    // the revision was derived from, as plain text: an error page, a 404 or
    // HTML is refused before the record is published.
    const served = "data.http.example_com_baseline_mail_policy";
    expect(discovery?.["lifecycle"]).toEqual({
      precondition: [
        {
          condition: `\${${served}.status_code == 200 && ${served}.response_body == ${JSON.stringify(POLICY)} && startswith(lookup(${served}.response_headers, "Content-Type", ""), "text/plain")}`,
          error_message:
            "Serve the exact HTTPS Fastmail policy as plain text before publishing MTA-STS discovery.",
        },
      ],
    });
  });

  test("discovery is refused for a domain Fastmail has not confirmed", async () => {
    await expect(
      baseline({ mtaStsPublished: true, fastmailReady: false }),
    ).rejects.toThrow(
      "confirm the domain in Fastmail before advertising transport enforcement",
    );
    await expect(baseline({ domain: "Example.com" })).rejects.toThrow(
      "must be a lowercase DNS name",
    );
  });
});

describe("domain baseline settings and addresses", () => {
  test("TLS, HSTS and CAA are the same for every zone but its TLS 1.3 mode", async () => {
    const { settings, records } = await baseline({ tls13: "zrt" });
    expect(
      Object.fromEntries(
        Object.entries(settings).map(([name, setting]) => [
          name,
          [setting["setting_id"], setting["value"]],
        ]),
      ),
    ).toEqual({
      example_com_baseline_https: ["always_use_https", "on"],
      example_com_baseline_ssl: ["ssl", "strict"],
      example_com_baseline_min_tls_version: ["min_tls_version", "1.2"],
      example_com_baseline_tls_1_3: ["tls_1_3", "zrt"],
      example_com_baseline_security_header: [
        "security_header",
        {
          strict_transport_security: {
            enabled: true,
            max_age: 86_400,
            include_subdomains: true,
            nosniff: true,
            preload: false,
          },
        },
      ],
    });
    expect(
      names(records).filter((name) => name.includes("_caa_")),
    ).toHaveLength(9);
    expect(
      records["example_com_baseline_caa_issuewild_google_trust_services"],
    ).toEqual({
      zone_id: ZONE_ID,
      ttl: 1,
      name: "example.com",
      type: "CAA",
      data: {
        flags: 0,
        tag: "issuewild",
        value: "pki.goog; cansignhttpexchanges=yes",
      },
    });
  });

  test("every resource is moved out of its module address, and a data source is not", async () => {
    const { stack, relocations } = await baseline({ mtaStsPublished: true });
    const instance = 'module.domain_baseline["example.com"]';
    expect(relocations).toHaveLength(30);
    expect(stack.moved).toEqual(
      relocations
        .filter((relocation) => !relocation.dataSource)
        .map(({ from, to }) => ({ from, to })),
    );
    expect(stack.moved).toHaveLength(29);
    expect(stack.moved).toEqual(
      expect.arrayContaining([
        {
          from: `${instance}.cloudflare_dns_record.mx["primary"]`,
          to: "cloudflare_dns_record.example_com_baseline_mx_primary",
        },
        {
          from: `${instance}.cloudflare_dns_record.mta_sts[0]`,
          to: "cloudflare_dns_record.example_com_baseline_mta_sts",
        },
        {
          from: `${instance}.cloudflare_ct_alerting.ct[0]`,
          to: "cloudflare_ct_alerting.example_com_baseline_ct",
        },
        {
          from: `${instance}.terraform_data.ct_recipient[0]`,
          to: "terraform_data.example_com_baseline_ct_recipient",
        },
      ]),
    );
    expect(relocations.filter((relocation) => relocation.dataSource)).toEqual([
      {
        from: `${instance}.data.http.mail_policy[0]`,
        to: "data.http.example_com_baseline_mail_policy",
        dataSource: true,
      },
    ]);
    // Settings that used to be implicit defaults are adopted, not created.
    expect(stack.import).toEqual([
      {
        id: `${ZONE_ID}/always_use_https`,
        to: "cloudflare_zone_setting.example_com_baseline_https",
      },
      {
        id: `${ZONE_ID}/ssl`,
        to: "cloudflare_zone_setting.example_com_baseline_ssl",
      },
      {
        id: `${ZONE_ID}/tls_1_3`,
        to: "cloudflare_zone_setting.example_com_baseline_tls_1_3",
      },
      { id: ZONE_ID, to: "cloudflare_ct_alerting.example_com_baseline_ct" },
    ]);
  });
});

describe("static-asset cache", () => {
  test("respects the origin's Cache-Control under the hashed prefixes only, behind Smart Tiered Cache", async () => {
    const stack = await synthesizeStack((scope) => {
      new CloudflareProvider(scope, "cloudflare");
      new StaticCache(scope, "example_com_static_cache", {
        zoneId: ZONE_ID,
        assetPrefixes: ["/_astro/", "/app/assets/"],
      }).moveIntoRoot(scope);
    });
    expect(stack.resource).toEqual({
      cloudflare_ruleset: {
        example_com_static_cache: {
          zone_id: ZONE_ID,
          name: "static-asset-cache",
          kind: "zone",
          phase: "http_request_cache_settings",
          rules: [
            {
              ref: "immutable_hashed_assets",
              description:
                "Respect origin Cache-Control for content-hashed assets",
              expression:
                'starts_with(http.request.uri.path, "/_astro/") or starts_with(http.request.uri.path, "/app/assets/")',
              action: "set_cache_settings",
              action_parameters: {
                cache: true,
                edge_ttl: { mode: "respect_origin" },
                browser_ttl: { mode: "respect_origin" },
                serve_stale: { disable_stale_while_updating: false },
              },
            },
          ],
        },
      },
      cloudflare_tiered_cache: {
        example_com_static_cache: { zone_id: ZONE_ID, value: "on" },
      },
    });
    expect(stack.moved).toEqual([
      {
        from: "module.example_com_static_cache.cloudflare_ruleset.static_asset_cache",
        to: "cloudflare_ruleset.example_com_static_cache",
      },
      {
        from: "module.example_com_static_cache.cloudflare_tiered_cache.smart",
        to: "cloudflare_tiered_cache.example_com_static_cache",
      },
    ]);
  });

  test("a zone with no hashed prefix gets no rule", async () => {
    await expect(
      synthesizeStack((scope) => {
        new StaticCache(scope, "example_com_static_cache", {
          zoneId: ZONE_ID,
          assetPrefixes: [],
        });
      }),
    ).rejects.toThrow("must contain at least one prefix");
  });
});
