import path from "node:path";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { domainRegistry } from "homelab/src/domain-registry.ts";
import {
  immutablePathPrefixesByZone,
  publicHostnames,
  tunnelCnameTarget,
} from "homelab/src/platform-model.ts";
import { synthesize } from "#scripts/synth.ts";
import { TUNNEL } from "#src/stacks/cloudflare/records.ts";

const STACK_DIRECTORY = path.resolve(
  import.meta.dir,
  "../../homelab/src/tofu/cloudflare",
);

const BlockSchema = z.record(z.string(), z.unknown());
const ConfigurationSchema = z.looseObject({
  terraform: z.looseObject({
    encryption: z.unknown().optional(),
    required_version: z.string(),
    required_providers: z.record(
      z.string(),
      z.object({ source: z.string(), version: z.string() }),
    ),
  }),
  provider: z.record(z.string(), z.array(BlockSchema)),
  variable: z.record(z.string(), BlockSchema),
  // The stack holds no HCL: no module call, and no local read with file().
  locals: z.undefined().optional(),
  module: z.undefined().optional(),
  data: z.record(z.string(), z.record(z.string(), BlockSchema)),
  resource: z.record(z.string(), z.record(z.string(), BlockSchema)),
  import: z.array(z.strictObject({ to: z.string(), id: z.string() })),
  moved: z.array(z.object({ from: z.string(), to: z.string() })),
  removed: z.array(BlockSchema),
  output: z.record(z.string(), BlockSchema),
});

async function cloudflare() {
  const synthesized = await synthesize();
  return ConfigurationSchema.parse(
    JSON.parse(synthesized.get("cloudflare") ?? ""),
  );
}

const DOMAINS = Object.keys(domainRegistry.domains);
/** `sjer.red` is `sjer_red`, the resource name of its zone. */
const zoneResource = (domain: string) => domain.replaceAll(/[.-]/gu, "_");
const zoneId = (domain: string) =>
  `\${cloudflare_zone.${zoneResource(domain)}.id}`;

describe("cloudflare stack", () => {
  test("keeps every resource address, provider constraint and plaintext state", async () => {
    const { resource, terraform, provider, variable } = await cloudflare();
    expect(
      Object.fromEntries(
        Object.entries(resource).map(([type, byName]) => [
          type,
          Object.keys(byName).length,
        ]),
      ),
    ).toEqual({
      cloudflare_ct_alerting: 10,
      // 92 application records and 208 of the ten baselines.
      cloudflare_dns_record: 300,
      cloudflare_r2_bucket: 4,
      cloudflare_r2_bucket_lifecycle: 4,
      cloudflare_r2_custom_domain: 2,
      cloudflare_r2_managed_domain: 4,
      cloudflare_ruleset: 8,
      cloudflare_tiered_cache: 3,
      cloudflare_turnstile_widget: 1,
      cloudflare_zone: 10,
      cloudflare_zone_dnssec: 10,
      cloudflare_zone_setting: 52,
      // Every zone but the one that keeps its existing alert recipient.
      terraform_data: 9,
    });
    expect(Object.keys(resource["cloudflare_zone"] ?? {}).toSorted()).toEqual(
      DOMAINS.map((domain) => zoneResource(domain)).toSorted(),
    );
    expect(
      Object.keys(resource["cloudflare_ruleset"] ?? {}).toSorted(),
    ).toEqual([
      "better_skill_capped_com_static_cache",
      "bulk_redirects",
      "clauderon_com_redirect",
      "discord_plays_pokemon_com_redirect",
      "scout_for_lol_com_static_cache",
      "sjer_red_redirects",
      "sjer_red_static_cache",
      "ts_mc_net_redirects",
    ]);
    // A bucket and the resources declared for it share its HCL name.
    for (const type of [
      "cloudflare_r2_bucket",
      "cloudflare_r2_bucket_lifecycle",
      "cloudflare_r2_managed_domain",
    ])
      expect(Object.keys(resource[type] ?? {}).toSorted(), type).toEqual([
        "jerred_archives",
        "pinterest_archives",
        "sjerred",
        "ts_mc",
      ]);
    expect(Object.keys(resource["cloudflare_r2_custom_domain"] ?? {})).toEqual([
      "sjerred",
      "ts_mc",
    ]);

    expect(terraform.required_version).toBe(">= 1.10.0");
    // The lock file records these constraints; different ones rewrite it.
    expect(terraform.required_providers).toEqual({
      cloudflare: { source: "cloudflare/cloudflare", version: "~> 5.27.0" },
      http: { source: "hashicorp/http", version: "~> 3.5" },
    });
    // One of the established plaintext states: no encryption block.
    expect(terraform.encryption).toBeUndefined();
    expect(provider).toEqual({ cloudflare: [{}], http: [{}] });
    expect(variable).toEqual({
      cloudflare_account_id: {
        description: "Cloudflare account ID",
        type: "string",
        sensitive: true,
      },
    });
  });

  test("every managed zone has its registry entry's baseline, rendered at synthesis", async () => {
    const { data, output, resource } = await cloudflare();
    const records = resource["cloudflare_dns_record"] ?? {};
    for (const [domain, entry] of Object.entries(domainRegistry.domains)) {
      const zone = zoneResource(domain);
      expect(resource["cloudflare_zone"]?.[zone]?.["name"]).toBe(domain);
      expect(
        resource["cloudflare_zone_setting"]?.[`${zone}_baseline_tls_1_3`],
        domain,
      ).toEqual({
        zone_id: zoneId(domain),
        setting_id: "tls_1_3",
        value: entry.tls13,
      });
      expect(
        `${zone}_baseline_wildcard_mx_primary` in records,
        `${domain} wildcard mail`,
      ).toBe(entry.fastmailReady && entry.wildcardMail);
      expect(
        `${zone}_baseline_mta_sts` in records,
        `${domain} MTA-STS discovery`,
      ).toBe(entry.mtaStsPublished);
      expect(
        data["http"]?.[`${zone}_baseline_mail_policy`] !== undefined,
        `${domain} served policy`,
      ).toBe(entry.mtaStsPublished);
      // One zone keeps the alert recipient it already had.
      expect(
        Object.keys(resource["cloudflare_ct_alerting"] ?? {}).filter((name) =>
          name.startsWith(`${zone}_baseline_`),
        ),
        domain,
      ).toEqual([
        domain === "better-skill-capped.com"
          ? `${zone}_baseline_ct_existing`
          : `${zone}_baseline_ct`,
      ]);
    }
    // The registry is read at synthesis: nothing is left for file() to read,
    // so the stack directory holds no HCL and no module.
    expect(
      await Array.fromAsync(
        new Bun.Glob("**/*.{tf,tftest.hcl}").scan({ cwd: STACK_DIRECTORY }),
      ),
    ).toEqual([]);
    expect(output["managed_domains"]).toEqual({
      description: "Domains covered by the shared security and mail baseline.",
      value: DOMAINS.toSorted(),
    });
    // Aggregate DMARC reports are authorized for every domain but sjer.red.
    expect(resource["cloudflare_dns_record"]?.["dmarc_report"]).toEqual({
      for_each: `\${toset([${DOMAINS.toSorted()
        .filter((domain) => domain !== "sjer.red")
        .map((domain) => `"${domain}"`)
        .join(", ")}])}`,
      zone_id: zoneId("sjer.red"),
      ttl: 1,
      name: "${each.key}._report._dmarc",
      type: "TXT",
      content: "v=DMARC1",
    });
  });

  test("static-asset caching follows the platform model's immutable prefixes", async () => {
    const { resource } = await cloudflare();
    const model = immutablePathPrefixesByZone();
    // Zones whose sites have immutable prefixes and no cache rule yet.
    const uncached = new Set(["glitter-boys.com", "ts-mc.net"]);
    const cached = [...model.keys()].filter((zone) => !uncached.has(zone));
    expect(cached.toSorted()).toEqual([
      "better-skill-capped.com",
      "scout-for-lol.com",
      "sjer.red",
    ]);
    expect(
      Object.keys(resource["cloudflare_tiered_cache"] ?? {}).toSorted(),
    ).toEqual(
      cached.map((zone) => `${zoneResource(zone)}_static_cache`).toSorted(),
    );
    const expression = (zone: string) =>
      z
        .object({ rules: z.array(z.looseObject({ expression: z.string() })) })
        .parse(
          resource["cloudflare_ruleset"]?.[
            `${zoneResource(zone)}_static_cache`
          ],
        ).rules[0]?.expression;
    for (const zone of cached)
      expect(expression(zone), zone).toBe(
        (model.get(zone) ?? [])
          .map((prefix) => `starts_with(http.request.uri.path, "${prefix}")`)
          .join(" or "),
      );
    expect(expression("scout-for-lol.com")).toBe(
      'starts_with(http.request.uri.path, "/_astro/") or starts_with(http.request.uri.path, "/app/assets/")',
    );
    expect(expression("better-skill-capped.com")).toBe(
      'starts_with(http.request.uri.path, "/assets/")',
    );
  });
});

describe("cloudflare records and redirects", () => {
  test("every public hostname of the platform model is a proxied tunnel CNAME", async () => {
    const { resource } = await cloudflare();
    const zones = Object.entries(resource["cloudflare_zone"] ?? {});
    const fqdns = Object.values(resource["cloudflare_dns_record"] ?? {})
      .filter(
        (record) =>
          record["content"] === tunnelCnameTarget() &&
          record["type"] === "CNAME" &&
          record["proxied"] === true,
      )
      .map((record) => {
        const zone = zones.find(
          ([name]) => record["zone_id"] === `\${cloudflare_zone.${name}.id}`,
        )?.[1]["name"];
        return record["name"] === zone
          ? String(zone)
          : `${String(record["name"])}.${String(zone)}`;
      });
    // Declared hostnames whose record is deliberately something else.
    const notTunnelRecords = new Set(["arcade.sjer.red", "clauderon.com"]);
    const declared = publicHostnames()
      .map((route) => route.hostname)
      .filter((hostname) => !notTunnelRecords.has(hostname));
    expect(declared.filter((hostname) => !fqdns.includes(hostname))).toEqual(
      [],
    );
    // Tunnel records no workload is routed from, kept from before the model.
    expect(fqdns.filter((fqdn) => !declared.includes(fqdn)).toSorted()).toEqual(
      [
        "better-skill-capped.com.sjer.red",
        "bluemap.ts-mc.net.sjer.red",
        "bugsink.shepherdjerred.com.sjer.red",
        "discord-plays-pokemon.com.sjer.red",
        "overseerr.sjer.red",
        "peertube.sjer.red",
        "ts-mc.net.sjer.red",
      ],
    );
  });

  test("a tunnel hostname is a proxied CNAME, and no record but the DMARC reports iterates", async () => {
    const { resource } = await cloudflare();
    const records = resource["cloudflare_dns_record"];
    const tunnel = Object.entries(records ?? {}).filter(
      ([, record]) => record["content"] === TUNNEL,
    );
    // 45 application hostnames and each zone's MTA-STS policy host.
    expect(tunnel).toHaveLength(55);
    for (const [name, record] of tunnel)
      expect(record, name).toMatchObject({
        type: "CNAME",
        proxied: true,
        ttl: 1,
      });
    expect(records?.["sjer_red_cname_argocd"]).toEqual({
      zone_id: zoneId("sjer.red"),
      ttl: 1,
      name: "argocd",
      type: "CNAME",
      content: TUNNEL,
      proxied: true,
    });
    expect(
      Object.entries(records ?? {})
        .filter(([, record]) => "for_each" in record || "count" in record)
        .map(([name]) => name),
    ).toEqual(["dmarc_report"]);
    // PostHog validates and terminates this one itself: unproxied, adopted
    // and never destroyed.
    expect(records?.["sjer_red_cname_posthog"]).toEqual({
      zone_id: zoneId("sjer.red"),
      ttl: 3600,
      name: "j",
      type: "CNAME",
      content: "a9373961b1c868668128.cf-prod-us-proxy.proxyhog.com",
      proxied: false,
      lifecycle: { prevent_destroy: true },
    });
    // SRV repeats its priority at the top level, as the provider reads it.
    expect(records?.["sjer_red_srv_pop3s"]).toEqual({
      zone_id: zoneId("sjer.red"),
      ttl: 1,
      name: "_pop3s._tcp",
      type: "SRV",
      priority: 10,
      data: { priority: 10, weight: 1, port: 995, target: "pop.fastmail.com" },
    });
  });

  test("an edge redirect is in place before the placeholder records that rely on it", async () => {
    const { resource } = await cloudflare();
    const records = resource["cloudflare_dns_record"];
    const rulesets = resource["cloudflare_ruleset"];
    expect(rulesets?.["clauderon_com_redirect"]).toEqual({
      zone_id: zoneId("clauderon.com"),
      name: "clauderon.com to sjer.red",
      kind: "zone",
      phase: "http_request_dynamic_redirect",
      rules: [
        {
          ref: "clauderon_to_sjer_red",
          description: "Redirect the retired Clauderon site to sjer.red",
          expression:
            '(http.host eq "clauderon.com" or http.host eq "www.clauderon.com")',
          action: "redirect",
          action_parameters: {
            from_value: {
              status_code: 301,
              preserve_query_string: true,
              target_url: {
                expression: 'concat("https://sjer.red", http.request.uri.path)',
              },
            },
          },
        },
      ],
    });
    expect(records?.["clauderon_com_apex"]).toMatchObject({
      type: "AAAA",
      content: "100::",
      proxied: true,
      depends_on: ["cloudflare_ruleset.clauderon_com_redirect"],
    });
    // Cloudflare rejects the A record while the old apex CNAME still exists.
    expect(records?.["clauderon_com_apex_ipv4"]).toMatchObject({
      type: "A",
      content: "192.0.2.1",
      depends_on: [
        "cloudflare_dns_record.clauderon_com_apex",
        "cloudflare_ruleset.clauderon_com_redirect",
      ],
    });
    for (const join of ["ts_mc_net_aaaa_join", "ts_mc_net_a_join"])
      expect(records?.[join]?.["depends_on"], join).toEqual([
        "cloudflare_ruleset.ts_mc_net_redirects",
      ]);
  });

  test("the bulk redirect ruleset keeps its rule ids and order and is never destroyed", async () => {
    const { resource } = await cloudflare();
    expect(resource["cloudflare_ruleset"]?.["bulk_redirects"]).toEqual({
      account_id: "${var.cloudflare_account_id}",
      name: "default",
      description: "",
      kind: "root",
      phase: "http_request_redirect",
      rules: [
        {
          ref: "fe1c9ab9b8c748b48f5903b135f23507",
          description: "sjerred",
          enabled: true,
          // The mail-policy hosts are excluded so they reach the tunnel.
          expression:
            '(http.request.full_uri in $sjerred) and not (http.host in {"mta-sts.jerredshepherd.com" "mta-sts.shepherdjerred.com"})',
          action: "redirect",
          action_parameters: {
            from_list: { key: "http.request.full_uri", name: "sjerred" },
          },
        },
        {
          ref: "100da224266e402bb21da80d01c5d179",
          description: "resume",
          enabled: false,
          expression: "http.request.full_uri in $resume",
          action: "redirect",
          action_parameters: {
            from_list: { key: "http.request.full_uri", name: "resume" },
          },
        },
      ],
      lifecycle: { prevent_destroy: true },
    });
  });
});

describe("cloudflare buckets, settings and widgets", () => {
  test("an R2 bucket is never destroyed, keeps r2.dev off and only aborts abandoned uploads", async () => {
    const { resource } = await cloudflare();
    for (const [name, bucket, maxAge, ruleId] of [
      [
        "jerred_archives",
        "jerred-archives",
        604_800,
        "abort-incomplete-multipart-uploads-7d",
      ],
      [
        "pinterest_archives",
        "pinterest-archives",
        604_800,
        "abort-incomplete-multipart-uploads-7d",
      ],
      ["sjerred", "sjerred", 86_400, "Default Multipart Abort Rule"],
      ["ts_mc", "ts-mc", 604_800, "Default Multipart Abort Rule"],
    ] as const) {
      const bucketName = `\${cloudflare_r2_bucket.${name}.name}`;
      expect(resource["cloudflare_r2_bucket"]?.[name], name).toEqual({
        account_id: "${var.cloudflare_account_id}",
        name: bucket,
        location: "WNAM",
        storage_class: "Standard",
        lifecycle: { prevent_destroy: true },
      });
      expect(resource["cloudflare_r2_managed_domain"]?.[name], name).toEqual({
        account_id: "${var.cloudflare_account_id}",
        bucket_name: bucketName,
        enabled: false,
      });
      expect(resource["cloudflare_r2_bucket_lifecycle"]?.[name], name).toEqual({
        account_id: "${var.cloudflare_account_id}",
        bucket_name: bucketName,
        rules: [
          {
            id: ruleId,
            enabled: true,
            conditions: { prefix: "" },
            abort_multipart_uploads_transition: {
              condition: { type: "Age", max_age: maxAge },
            },
          },
        ],
      });
    }
    // The public buckets are reachable only through their custom domains.
    expect(resource["cloudflare_r2_custom_domain"]).toEqual({
      sjerred: {
        account_id: "${var.cloudflare_account_id}",
        bucket_name: "${cloudflare_r2_bucket.sjerred.name}",
        domain: "files.sjer.red",
        zone_id: zoneId("sjer.red"),
        enabled: true,
        lifecycle: { prevent_destroy: true },
      },
      ts_mc: {
        account_id: "${var.cloudflare_account_id}",
        bucket_name: "${cloudflare_r2_bucket.ts_mc.name}",
        domain: "storage.ts-mc.net",
        zone_id: zoneId("ts-mc.net"),
        enabled: true,
        lifecycle: { prevent_destroy: true },
      },
    });
  });

  test("zone settings and the Turnstile widget keep their values and sensitive outputs", async () => {
    const { resource, output } = await cloudflare();
    // The settings outside the shared baseline.
    expect(
      Object.fromEntries(
        Object.entries(resource["cloudflare_zone_setting"] ?? {}).filter(
          ([name]) => !name.includes("_baseline_"),
        ),
      ),
    ).toEqual({
      sjer_red_websockets: {
        zone_id: zoneId("sjer.red"),
        setting_id: "websockets",
        value: "on",
      },
      sjer_red_fonts: {
        zone_id: zoneId("sjer.red"),
        setting_id: "fonts",
        value: "off",
      },
    });
    expect(resource["cloudflare_turnstile_widget"]).toEqual({
      storm_forum: {
        account_id: "${var.cloudflare_account_id}",
        name: "The Storm forum",
        domains: ["ts-mc.net", "storm-forum-beta.tailnet-1a49.ts.net"],
        mode: "managed",
      },
    });
    expect(Object.keys(output).toSorted()).toEqual([
      "managed_domains",
      "storm_forum_turnstile_secret_key",
      "storm_forum_turnstile_site_key",
    ]);
    expect(output["storm_forum_turnstile_site_key"]).toEqual({
      value: "${cloudflare_turnstile_widget.storm_forum.sitekey}",
      sensitive: true,
    });
    expect(output["storm_forum_turnstile_secret_key"]).toEqual({
      value: "${cloudflare_turnstile_widget.storm_forum.secret}",
      sensitive: true,
    });
  });
});
