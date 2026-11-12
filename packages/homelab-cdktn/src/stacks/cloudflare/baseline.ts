import { TerraformIterator, TerraformOutput, Token } from "cdktn";
import type { TerraformStack } from "cdktn";
import { domainRegistry } from "homelab/src/domain-registry.ts";
import { DnsRecord } from "#generated/providers/cloudflare/dns-record/index.ts";
import { DomainBaseline } from "#src/stacks/cloudflare/domain-baseline.ts";
import { TUNNEL } from "#src/stacks/cloudflare/records.ts";
import { MANAGED_DOMAINS, zoneResource } from "#src/stacks/cloudflare/zones.ts";
import type { ManagedDomain, Zones } from "#src/stacks/cloudflare/zones.ts";
import { moved } from "#src/state-migrations.ts";

const BASELINE = "module.domain_baseline";
/** The zone whose existing certificate-alert recipient is retained. */
const CT_RECIPIENT_RETAINED = "better-skill-capped.com";
/** The Cloudflare Registrar zone adopted through the normal CI apply. */
const STATICALLY_TYPED_ZONE_ID = "d4036b55fca60ca5f998866309e951d8";

/**
 * The shared security and mail baseline of every managed zone: one
 * {@link DomainBaseline} per domain of
 * `packages/homelab/src/domain-registry.json`, which is read here, at
 * synthesis. After changing the registry, re-synthesize and commit the
 * regenerated `cloudflare/main.tf.json`.
 */
export function domainBaseline(
  stack: TerraformStack,
  zones: Zones,
): DomainBaseline[] {
  const domains = Object.keys(domainRegistry.domains).toSorted();
  if (domains.join("\n") !== MANAGED_DOMAINS.toSorted().join("\n"))
    throw new Error(
      "Every Cloudflare zone must have exactly one domain registry entry and baseline binding.",
    );

  new TerraformOutput(stack, "managed_domains", {
    description: "Domains covered by the shared security and mail baseline.",
    value: domains,
  });

  // The module addresses of the baseline are moved from in two steps: into
  // the module, when it replaced the per-zone root resources, and out of it.
  baselineMoves(stack);
  const baselines = MANAGED_DOMAINS.map((domain) => {
    const entry = domainRegistry.domains[domain];
    if (entry === undefined)
      throw new Error(`${domain} has no domain registry entry`);
    const baseline = new DomainBaseline(stack, {
      domain,
      zoneId: zones[domain].id,
      resourcePrefix: zoneResource(domain),
      fastmailReady: entry.fastmailReady,
      wildcardMail: entry.wildcardMail,
      tls13: entry.tls13,
      mtaStsPublished: entry.mtaStsPublished,
      // This zone already has an alert recipient; retain it.
      ctAlertRecipient:
        domain === CT_RECIPIENT_RETAINED ? null : "root@sjer.red",
      mailPolicy: domainRegistry.mailPolicy,
      tunnelTarget: TUNNEL,
    });
    baseline.moveIntoRoot(stack);
    if (domain === "statically-typed.com") adoptStaticallyTyped(baseline);
    return baseline;
  });

  // Authorize aggregate reports to dmarc@sjer.red from every managed external
  // domain.
  const external = TerraformIterator.fromList(
    domains.filter((domain) => domain !== "sjer.red"),
  );
  new DnsRecord(stack, "dmarc_report", {
    forEach: external,
    zoneId: zones["sjer.red"].id,
    ttl: 1,
    name: `${Token.asString(external.key)}._report._dmarc`,
    type: "TXT",
    content: "v=DMARC1",
  });

  return baselines;
}

/**
 * statically-typed.com was adopted straight into the baseline, so the
 * settings every other zone moved in from its root are imported instead. The
 * zone itself is imported in `zones.ts`.
 */
function adoptStaticallyTyped(baseline: DomainBaseline): void {
  baseline.minTlsVersion.importFrom(
    `${STATICALLY_TYPED_ZONE_ID}/min_tls_version`,
  );
  baseline.securityHeader.importFrom(
    `${STATICALLY_TYPED_ZONE_ID}/security_header`,
  );
  baseline.dnssec.importFrom(STATICALLY_TYPED_ZONE_ID);
}

type AdoptedDomain = Exclude<ManagedDomain, "statically-typed.com">;

/** The zones that predate the baseline: their records moved into it. */
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
 * every per-zone root resource the HCL module replaced moved into its
 * domain's module instance, and {@link DomainBaseline} moves it on from
 * there. Kept until state no longer holds the old addresses.
 */
function baselineMoves(stack: TerraformStack): void {
  const adoptRecords = (
    domain: AdoptedDomain,
    records: Readonly<Record<string, string>>,
  ) => {
    for (const [suffix, address] of Object.entries(records))
      moved(
        stack,
        `cloudflare_dns_record.${zoneResource(domain)}_${suffix}`,
        `${BASELINE}["${domain}"].cloudflare_dns_record.${address}`,
      );
  };

  for (const domain of ADOPTED_DOMAINS) {
    const prefix = zoneResource(domain);
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
      `cloudflare_dns_record.sjer_red_dmarc_report_${zoneResource(domain)}`,
      `cloudflare_dns_record.dmarc_report["${domain}"]`,
    );

  // Keep the adopted zone identities while configuring delivery for new
  // alerts: certificate alerting became a counted resource.
  for (const domain of MANAGED_DOMAINS) {
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
