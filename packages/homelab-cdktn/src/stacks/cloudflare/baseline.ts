import {
  TerraformHclModule,
  TerraformIterator,
  TerraformLocal,
  TerraformOutput,
  Token,
} from "cdktn";
import type { TerraformStack } from "cdktn";
import { DnsRecord } from "#generated/providers/cloudflare/dns-record/index.ts";
import type { Zones } from "#src/stacks/cloudflare/zones.ts";
import { importAddress, moved } from "#src/state-migrations.ts";

const BASELINE = "module.domain_baseline";
const STATICALLY_TYPED = `${BASELINE}["statically-typed.com"]`;
/** The zone whose existing certificate-alert recipient is retained. */
const CT_RECIPIENT_RETAINED = "better-skill-capped.com";

/**
 * The shared security and mail baseline of every managed zone: one instance
 * of the HCL module `modules/domain-baseline` per domain in
 * `packages/homelab/src/domain-registry.json`. The module stays HCL in this
 * port, so every resource keeps its `module.domain_baseline["<domain>"].…`
 * address.
 *
 * OpenTofu still reads the registry at plan time, as the HCL root did, so a
 * registry change needs no re-synthesis and the stack archive keeps freezing
 * the file (`externalFiles` in `tofu-stack-manifest.ts`). Importing it here
 * belongs with flattening the module, which needs the domains at synthesis.
 */
export function domainBaseline(stack: TerraformStack, zones: Zones): void {
  new TerraformLocal(
    stack,
    "domain_registry",
    '${jsondecode(file("${path.module}/../../domain-registry.json"))}',
  );
  // Domain names are data, so the keys are not snake_cased.
  new TerraformLocal(
    stack,
    "baseline_zone_ids",
    Token.asAny(
      Object.fromEntries(
        Object.entries(zones).map(([domain, zone]) => [domain, zone.id]),
      ),
    ),
  );

  // cdktn drops an output's `precondition` from JSON synthesis, so it is an
  // override.
  new TerraformOutput(stack, "managed_domains", {
    description: "Domains covered by the shared security and mail baseline.",
    value: "${keys(local.domain_registry.domains)}",
  }).addOverride("precondition", {
    condition:
      "${toset(keys(local.domain_registry.domains)) == toset(keys(local.baseline_zone_ids))}",
    error_message:
      "Every Cloudflare zone must have exactly one domain registry entry and baseline binding.",
  });

  new TerraformHclModule(stack, "domain_baseline", {
    source: "./modules/domain-baseline",
    // The module directory is committed next to main.tf.json; cdktn would
    // otherwise copy it into the synthesis as an asset and rewrite `source`.
    skipAssetCreationFromLocalModules: true,
    forEach: TerraformIterator.fromMap(
      Token.asAnyMap("${local.domain_registry.domains}"),
    ),
    variables: {
      zone_id: "${local.baseline_zone_ids[each.key]}",
      domain: "${each.key}",
      fastmail_ready: "${each.value.fastmailReady}",
      wildcard_mail: "${each.value.wildcardMail}",
      tls_1_3: "${each.value.tls13}",
      mta_sts_published: "${each.value.mtaStsPublished}",
      // This zone already has an alert recipient; retain it during adoption.
      ct_alert_recipient: `\${each.key == "${CT_RECIPIENT_RETAINED}" ? null : "root@sjer.red"}`,
      mail_policy: "${local.domain_registry.mailPolicy}",
    },
  });

  // Authorize aggregate reports to dmarc@sjer.red from every managed external
  // domain.
  const external = TerraformIterator.fromMap(
    Token.asAnyMap(
      '${{ for domain, config in local.domain_registry.domains : domain => config if domain != "sjer.red" }}',
    ),
  );
  new DnsRecord(stack, "dmarc_report", {
    forEach: external,
    zoneId: zones["sjer.red"].id,
    ttl: 1,
    name: `${external.key}._report._dmarc`,
    type: "TXT",
    content: "v=DMARC1",
  });

  baselineImports(stack);
  baselineMoves(stack);
}

/**
 * Adopt existing control-plane settings rather than relying on implicit
 * defaults. The statically-typed.com zone itself is imported in `zones.ts`.
 */
function baselineImports(stack: TerraformStack): void {
  for (const [resource, setting] of [
    ["ssl", "ssl"],
    ["https", "always_use_https"],
    ["tls_1_3", "tls_1_3"],
  ] as const) {
    importAddress(stack, {
      forEach: "${local.baseline_zone_ids}",
      to: `${BASELINE}[each.key].cloudflare_zone_setting.${resource}`,
      id: `\${each.value}/${setting}`,
    });
  }
  importAddress(stack, {
    forEach: `\${{ for domain, zone_id in local.baseline_zone_ids : domain => zone_id if domain != "${CT_RECIPIENT_RETAINED}" }}`,
    to: `${BASELINE}[each.key].cloudflare_ct_alerting.ct[0]`,
    id: "${each.value}",
  });
  importAddress(stack, {
    to: `${BASELINE}["${CT_RECIPIENT_RETAINED}"].cloudflare_ct_alerting.ct_existing[0]`,
    id: `\${local.baseline_zone_ids["${CT_RECIPIENT_RETAINED}"]}`,
  });
  importAddress(stack, {
    to: `${STATICALLY_TYPED}.cloudflare_zone_setting.min_tls_version`,
    id: "d4036b55fca60ca5f998866309e951d8/min_tls_version",
  });
  importAddress(stack, {
    to: `${STATICALLY_TYPED}.cloudflare_zone_setting.security_header`,
    id: "d4036b55fca60ca5f998866309e951d8/security_header",
  });
  importAddress(stack, {
    to: `${STATICALLY_TYPED}.cloudflare_zone_dnssec.dnssec`,
    id: "d4036b55fca60ca5f998866309e951d8",
  });
}

/** Record-name prefix of each zone that predates the baseline module. */
const ADOPTED_ZONES = {
  "better-skill-capped.com": "better_skill_capped_com",
  "clauderon.com": "clauderon_com",
  "discord-plays-pokemon.com": "discord_plays_pokemon_com",
  "glitter-boys.com": "glitter_boys_com",
  "jerredshepherd.com": "jerredshepherd_com",
  "scout-for-lol.com": "scout_for_lol_com",
  "shepherdjerred.com": "shepherdjerred_com",
  "sjer.red": "sjer_red",
  "ts-mc.net": "ts_mc_net",
} as const;

type AdoptedDomain = keyof typeof ADOPTED_ZONES;

const ADOPTED_DOMAINS: readonly AdoptedDomain[] = [
  "better-skill-capped.com",
  "clauderon.com",
  "discord-plays-pokemon.com",
  "glitter-boys.com",
  "jerredshepherd.com",
  "scout-for-lol.com",
  "shepherdjerred.com",
  "sjer.red",
  "ts-mc.net",
];

/** Old root record suffix to its address inside a baseline instance. */
const SECURITY_RECORDS = {
  spf: "spf",
  dmarc: "dmarc",
  caa_iodef: "caa_iodef",
  caa_issue_letsencrypt: 'caa_issue["letsencrypt"]',
  caa_issue_google_trust_services: 'caa_issue["google_trust_services"]',
  caa_issue_sectigo: 'caa_issue["sectigo"]',
  caa_issue_ssl_com: 'caa_issue["ssl_com"]',
  caa_issuewild_none: 'caa_issuewild["letsencrypt"]',
} as const;

const MAIL_RECORDS = {
  dkim_fm1: 'dkim["fm1"]',
  dkim_fm2: 'dkim["fm2"]',
  dkim_fm3: 'dkim["fm3"]',
  mx1: 'mx["primary"]',
  mx2: 'mx["secondary"]',
} as const;

const WILDCARD_MAIL_RECORDS = {
  mx_wildcard1: 'wildcard_mx["primary"]',
  mx_wildcard2: 'wildcard_mx["secondary"]',
} as const;

/** The domains that already published each optional record set at the root. */
const HAD_TLS_REPORTING: readonly AdoptedDomain[] = [
  "shepherdjerred.com",
  "sjer.red",
  "ts-mc.net",
];
const HAD_MAIL: readonly AdoptedDomain[] = HAD_TLS_REPORTING;
const HAD_WILDCARD_MAIL: readonly AdoptedDomain[] = [
  "shepherdjerred.com",
  "ts-mc.net",
];
const HAD_DMARC_REPORT: readonly AdoptedDomain[] = [
  "better-skill-capped.com",
  "clauderon.com",
  "discord-plays-pokemon.com",
  "glitter-boys.com",
  "jerredshepherd.com",
  "scout-for-lol.com",
  "ts-mc.net",
];

/**
 * Preserve existing resource identities from before the shared baseline:
 * every per-zone root resource the module replaced moved into its domain's
 * instance. Kept until state no longer holds the old addresses.
 */
function baselineMoves(stack: TerraformStack): void {
  const adoptRecords = (
    domain: AdoptedDomain,
    records: Readonly<Record<string, string>>,
  ) => {
    for (const [suffix, address] of Object.entries(records))
      moved(
        stack,
        `cloudflare_dns_record.${ADOPTED_ZONES[domain]}_${suffix}`,
        `${BASELINE}["${domain}"].cloudflare_dns_record.${address}`,
      );
  };

  for (const domain of ADOPTED_DOMAINS) {
    const prefix = ADOPTED_ZONES[domain];
    const instance = `${BASELINE}["${domain}"]`;
    moved(
      stack,
      `cloudflare_zone_dnssec.${prefix}`,
      `${instance}.cloudflare_zone_dnssec.dnssec`,
    );
    for (const setting of ["min_tls_version", "security_header"])
      moved(
        stack,
        `cloudflare_zone_setting.${prefix}_${setting}`,
        `${instance}.cloudflare_zone_setting.${setting}`,
      );
  }
  for (const domain of ADOPTED_DOMAINS) adoptRecords(domain, SECURITY_RECORDS);
  for (const domain of HAD_TLS_REPORTING)
    adoptRecords(domain, { tlsrpt: "tlsrpt" });
  for (const domain of HAD_MAIL) adoptRecords(domain, MAIL_RECORDS);
  for (const domain of HAD_WILDCARD_MAIL)
    adoptRecords(domain, WILDCARD_MAIL_RECORDS);
  for (const domain of HAD_DMARC_REPORT)
    moved(
      stack,
      `cloudflare_dns_record.sjer_red_dmarc_report_${ADOPTED_ZONES[domain]}`,
      `cloudflare_dns_record.dmarc_report["${domain}"]`,
    );

  // Keep the adopted zone identities while configuring delivery for new
  // alerts: certificate alerting became a counted resource.
  for (const domain of [...ADOPTED_DOMAINS, "statically-typed.com"]) {
    const alerting = `${BASELINE}["${domain}"].cloudflare_ct_alerting`;
    moved(
      stack,
      `${alerting}.ct`,
      domain === CT_RECIPIENT_RETAINED
        ? `${alerting}.ct_existing[0]`
        : `${alerting}.ct[0]`,
    );
  }
}
