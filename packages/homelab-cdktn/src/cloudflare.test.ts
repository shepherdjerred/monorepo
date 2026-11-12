import path from "node:path";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { domainRegistry } from "homelab/src/domain-registry.ts";
import { synthesize } from "#scripts/synth.ts";
import { TUNNEL } from "#src/stacks/cloudflare/records.ts";

const BASELINE = "module.domain_baseline";
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
  locals: BlockSchema,
  module: z.record(z.string(), BlockSchema),
  resource: z.record(z.string(), z.record(z.string(), BlockSchema)),
  import: z.array(
    z.object({
      to: z.string(),
      id: z.string(),
      for_each: z.string().optional(),
    }),
  ),
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
      cloudflare_dns_record: 92,
      cloudflare_r2_bucket: 4,
      cloudflare_r2_bucket_lifecycle: 4,
      cloudflare_r2_custom_domain: 2,
      cloudflare_r2_managed_domain: 4,
      cloudflare_ruleset: 5,
      cloudflare_turnstile_widget: 1,
      cloudflare_zone: 10,
      cloudflare_zone_setting: 2,
    });
    expect(Object.keys(resource["cloudflare_zone"] ?? {}).toSorted()).toEqual(
      DOMAINS.map((domain) => zoneResource(domain)).toSorted(),
    );
    expect(
      Object.keys(resource["cloudflare_ruleset"] ?? {}).toSorted(),
    ).toEqual([
      "bulk_redirects",
      "clauderon_com_redirect",
      "discord_plays_pokemon_com_redirect",
      "sjer_red_redirects",
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
    expect(provider).toEqual({ cloudflare: [{}] });
    expect(variable).toEqual({
      cloudflare_account_id: {
        description: "Cloudflare account ID",
        type: "string",
        sensitive: true,
      },
    });
  });

  test("every managed zone is bound to its registry entry and one baseline instance", async () => {
    const { locals, module, output, resource } = await cloudflare();
    for (const domain of DOMAINS)
      expect(
        resource["cloudflare_zone"]?.[zoneResource(domain)]?.["name"],
      ).toBe(domain);
    // OpenTofu reads the registry at plan time; the archive freezes it.
    expect(locals["domain_registry"]).toBe(
      '${jsondecode(file("${path.module}/../../domain-registry.json"))}',
    );
    expect(locals["baseline_zone_ids"]).toEqual(
      Object.fromEntries(DOMAINS.map((domain) => [domain, zoneId(domain)])),
    );
    // The local HCL module, called under its HCL name with its HCL inputs,
    // so every `module.domain_baseline["<domain>"].…` address is unchanged.
    expect(module["domain_baseline"]).toEqual({
      source: "./modules/domain-baseline",
      for_each: "${local.domain_registry.domains}",
      zone_id: "${local.baseline_zone_ids[each.key]}",
      domain: "${each.key}",
      fastmail_ready: "${each.value.fastmailReady}",
      wildcard_mail: "${each.value.wildcardMail}",
      tls_1_3: "${each.value.tls13}",
      mta_sts_published: "${each.value.mtaStsPublished}",
      // An explicit null keeps the recipient that zone already had.
      ct_alert_recipient:
        '${each.key == "better-skill-capped.com" ? null : "root@sjer.red"}',
      mail_policy: "${local.domain_registry.mailPolicy}",
    });
    expect(
      await Bun.file(
        path.join(STACK_DIRECTORY, "modules/domain-baseline/main.tf"),
      ).exists(),
    ).toBe(true);
    // A zone without a registry entry, or the reverse, fails the plan.
    expect(output["managed_domains"]).toEqual({
      description: "Domains covered by the shared security and mail baseline.",
      value: "${keys(local.domain_registry.domains)}",
      precondition: {
        condition:
          "${toset(keys(local.domain_registry.domains)) == toset(keys(local.baseline_zone_ids))}",
        error_message:
          "Every Cloudflare zone must have exactly one domain registry entry and baseline binding.",
      },
    });
    // Aggregate DMARC reports are authorized for every domain but sjer.red.
    expect(resource["cloudflare_dns_record"]?.["dmarc_report"]).toEqual({
      for_each:
        '${{ for domain, config in local.domain_registry.domains : domain => config if domain != "sjer.red" }}',
      zone_id: zoneId("sjer.red"),
      ttl: 1,
      name: "${each.key}._report._dmarc",
      type: "TXT",
      content: "v=DMARC1",
    });
  });

  test("static-asset caching stays the HCL module, one call per cached zone", async () => {
    const { module } = await cloudflare();
    expect(Object.keys(module).toSorted()).toEqual([
      "better_skill_capped_com_static_cache",
      "domain_baseline",
      "scout_for_lol_com_static_cache",
      "sjer_red_static_cache",
    ]);
    expect(module["better_skill_capped_com_static_cache"]).toEqual({
      source: "./modules/static-cache",
      zone_id: zoneId("better-skill-capped.com"),
      asset_prefixes: ["/assets/"],
    });
    expect(module["scout_for_lol_com_static_cache"]).toEqual({
      source: "./modules/static-cache",
      zone_id: zoneId("scout-for-lol.com"),
      asset_prefixes: ["/_astro/", "/app/assets/"],
    });
    expect(module["sjer_red_static_cache"]).toEqual({
      source: "./modules/static-cache",
      zone_id: zoneId("sjer.red"),
      asset_prefixes: ["/_astro/"],
    });
  });
});

describe("cloudflare records and redirects", () => {
  test("a tunnel hostname is a proxied CNAME, and no record but the DMARC reports iterates", async () => {
    const { resource } = await cloudflare();
    const records = resource["cloudflare_dns_record"];
    const tunnel = Object.entries(records ?? {}).filter(
      ([, record]) => record["content"] === TUNNEL,
    );
    expect(tunnel).toHaveLength(45);
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
    expect(resource["cloudflare_zone_setting"]).toEqual({
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

describe("cloudflare state migrations", () => {
  test("adopts every object the stack imports, at its address", async () => {
    const { import: imports } = await cloudflare();
    const perZone = "${local.baseline_zone_ids}";
    expect(imports).toEqual([
      {
        to: "cloudflare_zone.statically_typed_com",
        id: "d4036b55fca60ca5f998866309e951d8",
      },
      {
        to: "cloudflare_dns_record.sjer_red_cname_posthog",
        id: "879487f81194d63121d0b8dddd16f08f/cf96abd1cc751274baa8e16df54e2b45",
      },
      {
        to: "cloudflare_r2_bucket.sjerred",
        id: "${nonsensitive(var.cloudflare_account_id)}/sjerred/default",
      },
      {
        to: "cloudflare_r2_bucket.ts_mc",
        id: "${nonsensitive(var.cloudflare_account_id)}/ts-mc/default",
      },
      {
        to: "cloudflare_ruleset.bulk_redirects",
        id: "accounts/48948ed6cd40d73e34d27f0cc10e595f/ea1ab5d0737441118d227236662533ac",
      },
      {
        for_each: perZone,
        to: `${BASELINE}[each.key].cloudflare_zone_setting.ssl`,
        id: "${each.value}/ssl",
      },
      {
        for_each: perZone,
        to: `${BASELINE}[each.key].cloudflare_zone_setting.https`,
        id: "${each.value}/always_use_https",
      },
      {
        for_each: perZone,
        to: `${BASELINE}[each.key].cloudflare_zone_setting.tls_1_3`,
        id: "${each.value}/tls_1_3",
      },
      {
        for_each:
          '${{ for domain, zone_id in local.baseline_zone_ids : domain => zone_id if domain != "better-skill-capped.com" }}',
        to: `${BASELINE}[each.key].cloudflare_ct_alerting.ct[0]`,
        id: "${each.value}",
      },
      {
        to: `${BASELINE}["better-skill-capped.com"].cloudflare_ct_alerting.ct_existing[0]`,
        id: '${local.baseline_zone_ids["better-skill-capped.com"]}',
      },
      {
        to: `${BASELINE}["statically-typed.com"].cloudflare_zone_setting.min_tls_version`,
        id: "d4036b55fca60ca5f998866309e951d8/min_tls_version",
      },
      {
        to: `${BASELINE}["statically-typed.com"].cloudflare_zone_setting.security_header`,
        id: "d4036b55fca60ca5f998866309e951d8/security_header",
      },
      {
        to: `${BASELINE}["statically-typed.com"].cloudflare_zone_dnssec.dnssec`,
        id: "d4036b55fca60ca5f998866309e951d8",
      },
    ]);
  });

  test("keeps every applied move into the baseline module and none out of it", async () => {
    const { moved } = await cloudflare();
    expect(moved).toHaveLength(139);
    expect(new Set(moved.map(({ from }) => from)).size).toBe(139);
    expect(new Set(moved.map(({ to }) => to)).size).toBe(139);
    const byFrom = new Map(moved.map(({ from, to }) => [from, to]));
    expect(byFrom.get("cloudflare_dns_record.clauderon_com_cname_apex")).toBe(
      "cloudflare_dns_record.clauderon_com_apex",
    );
    expect(byFrom.get("cloudflare_zone_dnssec.sjer_red")).toBe(
      `${BASELINE}["sjer.red"].cloudflare_zone_dnssec.dnssec`,
    );
    expect(
      byFrom.get("cloudflare_dns_record.ts_mc_net_caa_issuewild_none"),
    ).toBe(
      `${BASELINE}["ts-mc.net"].cloudflare_dns_record.caa_issuewild["letsencrypt"]`,
    );
    expect(
      byFrom.get("cloudflare_dns_record.shepherdjerred_com_mx_wildcard2"),
    ).toBe(
      `${BASELINE}["shepherdjerred.com"].cloudflare_dns_record.wildcard_mx["secondary"]`,
    );
    expect(
      byFrom.get(
        "cloudflare_dns_record.sjer_red_dmarc_report_glitter_boys_com",
      ),
    ).toBe('cloudflare_dns_record.dmarc_report["glitter-boys.com"]');
    // Certificate alerting became a counted resource in every zone; the one
    // zone with an existing recipient moved to the resource that keeps it.
    for (const domain of DOMAINS) {
      const alerting = `${BASELINE}["${domain}"].cloudflare_ct_alerting`;
      expect(byFrom.get(`${alerting}.ct`), domain).toBe(
        domain === "better-skill-capped.com"
          ? `${alerting}.ct_existing[0]`
          : `${alerting}.ct[0]`,
      );
    }
    // statically-typed.com was adopted straight into the module.
    const moves = (prefix: string) =>
      moved.filter(({ from }) => from.includes(`.${prefix}`)).length;
    expect(moves("statically_typed_com")).toBe(0);
    expect(moves("better_skill_capped_com")).toBe(11);
    expect(moves("shepherdjerred_com")).toBe(19);
    expect(moves("sjer_red")).toBe(17 + 7);
    expect(moves("ts_mc_net")).toBe(19);
  });

  test("forgets the retired buckets without destroying them", async () => {
    const { removed } = await cloudflare();
    expect(removed).toEqual(
      [
        "cloudflare_r2_bucket.glitter_discord_corpus",
        "cloudflare_r2_bucket.seaweedfs_backups",
        "cloudflare_r2_bucket_lock.seaweedfs_backups",
        "cloudflare_r2_bucket_lifecycle.seaweedfs_backups",
        "cloudflare_r2_bucket.postgres_wal",
        "cloudflare_r2_bucket_lifecycle.postgres_wal",
        "cloudflare_r2_bucket.homelab",
        "cloudflare_r2_bucket_lifecycle.homelab",
      ].map((from) => ({ from, lifecycle: { destroy: false } })),
    );
  });
});
