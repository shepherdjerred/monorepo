import { describe, expect, test } from "vitest";
import { z } from "zod";
import { domainRegistry } from "homelab/src/domain-registry.ts";
import { synthesizedStack } from "#src/testing.ts";

const BASELINE = "module.domain_baseline";
const STATICALLY_TYPED = "d4036b55fca60ca5f998866309e951d8";

const BlockSchema = z.record(z.string(), z.unknown());
const ConfigurationSchema = z.looseObject({
  resource: z.record(z.string(), z.record(z.string(), BlockSchema)),
  import: z.array(z.strictObject({ to: z.string(), id: z.string() })),
  moved: z.array(z.strictObject({ from: z.string(), to: z.string() })),
  removed: z.array(BlockSchema),
});

const cloudflare = () => synthesizedStack("cloudflare", ConfigurationSchema);

const DOMAINS = Object.keys(domainRegistry.domains);
const CACHED_ZONES = [
  "better-skill-capped.com",
  "scout-for-lol.com",
  "sjer.red",
];
/** `sjer.red` is `sjer_red`, the resource name of its zone. */
const zoneResource = (domain: string) => domain.replaceAll(/[.-]/gu, "_");
const zoneId = (domain: string) =>
  `\${cloudflare_zone.${zoneResource(domain)}.id}`;
const keyed = (name: string, keys: string[]) =>
  keys.map((key) => `${name}["${key}"]`);
const sorted = (blocks: { to: string; id: string }[]) =>
  blocks.toSorted((left, right) => left.to.localeCompare(right.to));

/**
 * Every managed address the two HCL modules declared, written out from the
 * modules' own resource blocks and conditions, independently of the
 * constructs that replaced them.
 */
function moduleAddresses(): string[] {
  const authorities = [
    "letsencrypt",
    "google_trust_services",
    "sectigo",
    "ssl_com",
  ];
  const baseline = Object.entries(domainRegistry.domains).flatMap(
    ([domain, entry]) => {
      const retained = domain === "better-skill-capped.com";
      const records = [
        ...(entry.fastmailReady ? keyed("mx", ["primary", "secondary"]) : []),
        ...(entry.fastmailReady && entry.wildcardMail
          ? keyed("wildcard_mx", ["primary", "secondary"])
          : []),
        ...keyed("dkim", ["fm1", "fm2", "fm3"]),
        "spf",
        "dmarc",
        "tlsrpt",
        "mta_sts_host",
        ...(entry.mtaStsPublished ? ["mta_sts[0]"] : []),
        ...keyed("caa_issue", authorities),
        ...keyed("caa_issuewild", authorities),
        "caa_iodef",
      ].map((name) => `cloudflare_dns_record.${name}`);
      const settings = [
        "https",
        "ssl",
        "min_tls_version",
        "tls_1_3",
        "security_header",
      ].map((name) => `cloudflare_zone_setting.${name}`);
      return [
        "cloudflare_zone_dnssec.dnssec",
        ...records,
        ...settings,
        ...(retained
          ? ["cloudflare_ct_alerting.ct_existing[0]"]
          : ["terraform_data.ct_recipient[0]", "cloudflare_ct_alerting.ct[0]"]),
      ].map((address) => `${BASELINE}["${domain}"].${address}`);
    },
  );
  const caches = CACHED_ZONES.flatMap((zone) => [
    `module.${zoneResource(zone)}_static_cache.cloudflare_ruleset.static_asset_cache`,
    `module.${zoneResource(zone)}_static_cache.cloudflare_tiered_cache.smart`,
  ]);
  return [...baseline, ...caches];
}

/** Every managed address the configuration declares, `for_each` expanded. */
function declaredAddresses(
  resource: z.infer<typeof ConfigurationSchema>["resource"],
): string[] {
  return Object.entries(resource).flatMap(([type, byName]) =>
    Object.entries(byName).flatMap(([name, attributes]) => {
      if (attributes["for_each"] === undefined) return [`${type}.${name}`];
      // The one iterated resource: a DMARC report record per external domain.
      expect(`${type}.${name}`).toBe("cloudflare_dns_record.dmarc_report");
      return DOMAINS.filter((domain) => domain !== "sjer.red").map(
        (domain) => `${type}.${name}["${domain}"]`,
      );
    }),
  );
}

describe("cloudflare state migrations", () => {
  test("every module address moves to a declared root address, and nothing is orphaned", async () => {
    const { moved, resource } = await cloudflare();
    const byFrom = new Map(moved.map(({ from, to }) => [from, to]));
    expect(byFrom.size, "one move per source address").toBe(moved.length);
    expect(new Set(moved.map(({ to }) => to)).size).toBe(moved.length);
    const settle = (address: string) => {
      let current = address;
      for (let hops = 0; byFrom.has(current); hops += 1) {
        expect(hops, `move cycle at ${address}`).toBeLessThan(4);
        current = byFrom.get(current) ?? current;
      }
      return current;
    };

    // The moves out of the modules are exactly the modules' addresses.
    const flattened = moved.filter(
      ({ from, to }) => from.startsWith("module.") && !to.startsWith("module."),
    );
    const before = moduleAddresses();
    expect(flattened.map(({ from }) => from).toSorted()).toEqual(
      before.toSorted(),
    );
    expect(flattened).toHaveLength(293);

    // Old address set, mapped through the moves, equals the new one.
    const declared = declaredAddresses(resource);
    const root = declared.filter(
      (address) => !/_baseline_|_static_cache$/u.test(address),
    );
    const after = [...before, ...root].map((address) => settle(address));
    expect(after.toSorted()).toEqual(declared.toSorted());
    expect(new Set(after).size).toBe(after.length);
    // Every address any move ends at is declared: none ends inside a module.
    for (const { from } of moved)
      expect(declared, from).toContain(settle(from));
  });

  test("a baseline resource keeps the identity it had before and inside the module", async () => {
    const { moved } = await cloudflare();
    expect(moved).toHaveLength(139 + 293);
    const byFrom = new Map(moved.map(({ from, to }) => [from, to]));
    const chain = (address: string) => {
      const hops = [address];
      for (let next = byFrom.get(address); next !== undefined;)
        next = byFrom.get(hops[hops.push(next) - 1] ?? "");
      return hops;
    };
    expect(chain("cloudflare_zone_dnssec.sjer_red")).toEqual([
      "cloudflare_zone_dnssec.sjer_red",
      `${BASELINE}["sjer.red"].cloudflare_zone_dnssec.dnssec`,
      "cloudflare_zone_dnssec.sjer_red_baseline_dnssec",
    ]);
    expect(chain("cloudflare_dns_record.ts_mc_net_caa_issuewild_none")).toEqual(
      [
        "cloudflare_dns_record.ts_mc_net_caa_issuewild_none",
        `${BASELINE}["ts-mc.net"].cloudflare_dns_record.caa_issuewild["letsencrypt"]`,
        "cloudflare_dns_record.ts_mc_net_baseline_caa_issuewild_letsencrypt",
      ],
    );
    expect(
      chain("cloudflare_dns_record.shepherdjerred_com_mx_wildcard2"),
    ).toEqual([
      "cloudflare_dns_record.shepherdjerred_com_mx_wildcard2",
      `${BASELINE}["shepherdjerred.com"].cloudflare_dns_record.wildcard_mx["secondary"]`,
      "cloudflare_dns_record.shepherdjerred_com_baseline_wildcard_mx_secondary",
    ]);
    // Certificate alerting became a counted resource in every zone; the one
    // zone with an existing recipient moved to the resource that keeps it.
    for (const domain of DOMAINS) {
      const alerting = `${BASELINE}["${domain}"].cloudflare_ct_alerting`;
      const retained = domain === "better-skill-capped.com";
      expect(chain(`${alerting}.ct`), domain).toEqual([
        `${alerting}.ct`,
        retained ? `${alerting}.ct_existing[0]` : `${alerting}.ct[0]`,
        `cloudflare_ct_alerting.${zoneResource(domain)}_baseline_${retained ? "ct_existing" : "ct"}`,
      ]);
    }
    // Moves that never involved a module are untouched.
    expect(chain("cloudflare_dns_record.clauderon_com_cname_apex")).toEqual([
      "cloudflare_dns_record.clauderon_com_cname_apex",
      "cloudflare_dns_record.clauderon_com_apex",
    ]);
    expect(
      chain("cloudflare_dns_record.sjer_red_dmarc_report_glitter_boys_com"),
    ).toEqual([
      "cloudflare_dns_record.sjer_red_dmarc_report_glitter_boys_com",
      'cloudflare_dns_record.dmarc_report["glitter-boys.com"]',
    ]);
    expect(
      chain(
        "module.sjer_red_static_cache.cloudflare_ruleset.static_asset_cache",
      ),
    ).toEqual([
      "module.sjer_red_static_cache.cloudflare_ruleset.static_asset_cache",
      "cloudflare_ruleset.sjer_red_static_cache",
    ]);
  });

  test("adopts every object the stack imports, at its root address", async () => {
    const { import: imports, resource } = await cloudflare();
    const declared = declaredAddresses(resource);
    for (const { to } of imports) expect(declared, to).toContain(to);
    const baseline = DOMAINS.flatMap((domain) => {
      const prefix = `${zoneResource(domain)}_baseline`;
      const setting = (name: string) =>
        `cloudflare_zone_setting.${prefix}_${name}`;
      const retained = domain === "better-skill-capped.com";
      return [
        { to: setting("https"), id: `${zoneId(domain)}/always_use_https` },
        { to: setting("ssl"), id: `${zoneId(domain)}/ssl` },
        { to: setting("tls_1_3"), id: `${zoneId(domain)}/tls_1_3` },
        {
          to: `cloudflare_ct_alerting.${prefix}_${retained ? "ct_existing" : "ct"}`,
          id: zoneId(domain),
        },
      ];
    });
    expect(sorted(imports)).toEqual(
      sorted([
        {
          to: "cloudflare_zone.statically_typed_com",
          id: STATICALLY_TYPED,
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
        ...baseline,
        // statically-typed.com was adopted straight into the baseline.
        {
          to: "cloudflare_zone_setting.statically_typed_com_baseline_min_tls_version",
          id: `${STATICALLY_TYPED}/min_tls_version`,
        },
        {
          to: "cloudflare_zone_setting.statically_typed_com_baseline_security_header",
          id: `${STATICALLY_TYPED}/security_header`,
        },
        {
          to: "cloudflare_zone_dnssec.statically_typed_com_baseline_dnssec",
          id: STATICALLY_TYPED,
        },
      ]),
    );
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
