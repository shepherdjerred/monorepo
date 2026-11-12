import type { TerraformStack } from "cdktn";
import { mailPolicyHosts } from "homelab/src/domain-registry.ts";
import {
  immutablePathPrefixesByZone,
  publicHostnames,
  zoneOf,
} from "homelab/src/platform-model.ts";
import { tunnelCnames } from "#src/stacks/cloudflare/records.ts";
import { StaticCache } from "#src/stacks/cloudflare/static-cache.ts";
import { zoneResource, managedDomain } from "#src/stacks/cloudflare/zones.ts";
import type { ManagedDomain, Zones } from "#src/stacks/cloudflare/zones.ts";

/**
 * What this stack renders from the shared platform model
 * (`packages/homelab/src/platform-model.json`), which cdk8s renders the other
 * half of: a public hostname is a TunnelBinding there and a proxied CNAME
 * here, and a static site's immutable prefixes are a bucket expiry rule and
 * a zone cache rule. Declaring a hostname or site in the model is enough for
 * both.
 *
 * The exceptions below are the same disagreements the both-sides test lists
 * as debt (`cdk8s/src/platform-model/debt-allowlists.ts`). Removing one here
 * changes live DNS or caching, so it is its own reviewed plan.
 */

/** Declared hostnames whose record is deliberately not a tunnel CNAME. */
const NOT_TUNNEL_RECORDS: ReadonlySet<string> = new Set([
  // An unproxied CNAME to the arcade edge (`sjer-red.ts`).
  "arcade.sjer.red",
  // Retired: a placeholder address behind an edge redirect (`domains.ts`).
  "clauderon.com",
]);

/** Zones whose sites have immutable prefixes but no cache rule yet. */
const UNCACHED_ZONES: ReadonlySet<ManagedDomain> = new Set([
  "glitter-boys.com",
  "ts-mc.net",
]);

/**
 * The record a hostname has in its zone: the resource is
 * `<zone>_cname_<label>` (`_apex` for the zone itself), and the name is
 * relative to the zone, as every record of this stack is written.
 */
function tunnelRecord(hostname: string): {
  domain: ManagedDomain;
  id: string;
  name: string;
} {
  const domain = managedDomain(zoneOf(hostname));
  const apex = hostname === domain;
  const name = apex ? domain : hostname.slice(0, -`.${domain}`.length);
  const label = apex ? "apex" : name.replaceAll(/[.-]/gu, "_");
  return { domain, id: `${zoneResource(domain)}_cname_${label}`, name };
}

/**
 * A proxied CNAME to the tunnel for every public hostname of the model. The
 * MTA-STS policy hosts are not here: each zone's baseline provisions its own.
 */
export function modelTunnelCnames(stack: TerraformStack, zones: Zones): void {
  const policyHosts = new Set(mailPolicyHosts.map((host) => host.hostname));
  for (const { hostname } of publicHostnames()) {
    if (policyHosts.has(hostname) || NOT_TUNNEL_RECORDS.has(hostname)) continue;
    const { domain, id, name } = tunnelRecord(hostname);
    tunnelCnames(stack, zones[domain], { [id]: name });
  }
}

/**
 * Static-asset caching for every zone whose static sites declare immutable
 * prefixes: respect the immutable Cache-Control the deploy sets on
 * content-hashed assets, plus Smart Tiered Cache.
 */
export function staticCaches(
  stack: TerraformStack,
  zones: Zones,
): StaticCache[] {
  const caches: StaticCache[] = [];
  for (const [zone, assetPrefixes] of immutablePathPrefixesByZone()) {
    const domain = managedDomain(zone);
    if (UNCACHED_ZONES.has(domain)) continue;
    caches.push(
      new StaticCache(stack, `${zoneResource(domain)}_static_cache`, {
        zoneId: zones[domain].id,
        assetPrefixes,
      }),
    );
  }
  return caches;
}
