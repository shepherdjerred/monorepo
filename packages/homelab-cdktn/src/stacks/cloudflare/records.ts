import type { ITerraformDependable, TerraformStack } from "cdktn";
import { DnsRecord } from "#generated/providers/cloudflare/dns-record/index.ts";
import { tunnelCnameTarget } from "homelab/src/platform-model.ts";
import type { Zone } from "#generated/providers/cloudflare/zone/index.ts";

/**
 * The homelab Cloudflare Tunnel every public hostname is routed through, as
 * the platform model names it for the TunnelBindings cdk8s renders.
 */
export const TUNNEL = tunnelCnameTarget();

/**
 * Record helpers for the cloudflare stack. Each creates one
 * `cloudflare_dns_record` directly in the stack with the given resource name,
 * so its address is `cloudflare_dns_record.<id>`, and sets exactly the
 * attributes the record has always declared.
 *
 * DKIM public keys and ownership challenges are opaque public DNS data: they
 * are kept by resource name in `published-txt-records.json`, not inline.
 */
export function cname(
  stack: TerraformStack,
  id: string,
  zone: Zone,
  record: { name: string; content: string; proxied: boolean },
): DnsRecord {
  return new DnsRecord(stack, id, {
    zoneId: zone.id,
    ttl: 1,
    name: record.name,
    type: "CNAME",
    content: record.content,
    proxied: record.proxied,
  });
}

/** Proxied CNAMEs to the tunnel, as resource name to record name. */
export function tunnelCnames(
  stack: TerraformStack,
  zone: Zone,
  records: Readonly<Record<string, string>>,
): void {
  for (const [id, name] of Object.entries(records))
    cname(stack, id, zone, { name, content: TUNNEL, proxied: true });
}

/**
 * A proxied placeholder address (RFC 6666 `100::` or RFC 5737 `192.0.2.1`):
 * Cloudflare's edge answers and runs the zone's redirect ruleset before any
 * origin fetch, so the address is never contacted.
 */
export function edgePlaceholder(
  stack: TerraformStack,
  id: string,
  zone: Zone,
  record: {
    name: string;
    type: "A" | "AAAA";
    dependsOn?: ITerraformDependable[];
  },
): DnsRecord {
  return new DnsRecord(stack, id, {
    zoneId: zone.id,
    ttl: 1,
    name: record.name,
    type: record.type,
    content: record.type === "AAAA" ? "100::" : "192.0.2.1",
    proxied: true,
    ...(record.dependsOn === undefined ? {} : { dependsOn: record.dependsOn }),
  });
}

export function txt(
  stack: TerraformStack,
  id: string,
  zone: Zone,
  record: { name: string; content: string },
): DnsRecord {
  return new DnsRecord(stack, id, {
    zoneId: zone.id,
    ttl: 1,
    name: record.name,
    type: "TXT",
    content: record.content,
  });
}

export function mx(
  stack: TerraformStack,
  id: string,
  zone: Zone,
  record: { name: string; content: string; priority: number },
): DnsRecord {
  return new DnsRecord(stack, id, {
    zoneId: zone.id,
    ttl: 1,
    name: record.name,
    type: "MX",
    content: record.content,
    priority: record.priority,
  });
}

type Service = {
  name: string;
  priority: number;
  weight: number;
  port: number;
  target: string;
};

/** SRV records, as resource name to service. */
export function srvRecords(
  stack: TerraformStack,
  zone: Zone,
  records: Readonly<Record<string, Service>>,
): void {
  for (const [id, service] of Object.entries(records)) {
    new DnsRecord(stack, id, {
      zoneId: zone.id,
      ttl: 1,
      name: service.name,
      type: "SRV",
      priority: service.priority,
      data: {
        priority: service.priority,
        weight: service.weight,
        port: service.port,
        target: service.target,
      },
    });
  }
}

function offered(
  name: string,
  port: number,
  target: string,
  priority = 0,
): Service {
  return { name, priority, weight: 1, port, target };
}

/** A service the domain announces it does not offer (RFC 2782 target `.`). */
function unavailable(name: string): Service {
  return { name, priority: 0, weight: 0, port: 0, target: "." };
}

/**
 * Fastmail client autodiscovery for a mail domain, as SRV records named
 * `<prefix>_srv_<service>`. The plaintext services are announced as
 * unavailable.
 */
export function fastmailAutodiscovery(
  stack: TerraformStack,
  zone: Zone,
  prefix: string,
): void {
  srvRecords(stack, zone, {
    [`${prefix}_srv_caldavs`]: offered(
      "_caldavs._tcp",
      443,
      "caldav.fastmail.com",
    ),
    [`${prefix}_srv_caldav`]: unavailable("_caldav._tcp"),
    [`${prefix}_srv_carddavs`]: offered(
      "_carddavs._tcp",
      443,
      "carddav.fastmail.com",
    ),
    [`${prefix}_srv_carddav`]: unavailable("_carddav._tcp"),
    [`${prefix}_srv_imaps`]: offered("_imaps._tcp", 993, "imap.fastmail.com"),
    [`${prefix}_srv_imap`]: unavailable("_imap._tcp"),
    [`${prefix}_srv_pop3s`]: offered(
      "_pop3s._tcp",
      995,
      "pop.fastmail.com",
      10,
    ),
    [`${prefix}_srv_pop3`]: unavailable("_pop3._tcp"),
    [`${prefix}_srv_submission`]: offered(
      "_submission._tcp",
      587,
      "smtp.fastmail.com",
    ),
  });
}
