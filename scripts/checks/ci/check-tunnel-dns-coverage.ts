#!/usr/bin/env bun

import path from "node:path";
import {
  publicHostnames,
  tunnelCnameTarget,
} from "../../../packages/homelab/src/platform-model.ts";
import {
  readSynthesizedConfiguration,
  type SynthesizedConfiguration,
} from "../../../packages/homelab/scripts/tofu/synthesized-configuration.ts";
import {
  synthesizedDnsRecords,
  synthesizedZones,
} from "./tunnel-dns-synthesized.ts";

const REPO_ROOT = path.resolve(import.meta.dir, "..", "..", "..");
const PLATFORM_MODEL = "packages/homelab/src/platform-model.json";
const TOFU_CLOUDFLARE = path.join(
  REPO_ROOT,
  "packages/homelab/src/tofu/cloudflare",
);

export type TunnelBinding = {
  fqdn: string;
  /** The `<namespace>/<service>` the hostname is routed to. */
  service: string;
};

export type DnsName = {
  file: string;
  line: number;
  resourceName: string;
  /** The record's literal `name` */
  name: string;
  /** Zone resource name (`sjer_red` for `cloudflare_zone.sjer_red.id`), if discoverable */
  zoneRef: string | undefined;
};

export type Zone = {
  /** The `cloudflare_zone` resource name, e.g. `sjer_red` */
  ref: string;
  /** The FQDN of the zone, e.g. `sjer.red` */
  name: string;
};

/**
 * Every hostname cdk8s binds to the tunnel. cdk8s renders its TunnelBindings
 * from the platform model, so the model is the list: the declared hostnames,
 * each static site, and each registered domain's MTA-STS policy host.
 */
export function collectTunnelBindings(): TunnelBinding[] {
  return publicHostnames().map((route) => ({
    fqdn: route.hostname,
    service: `${route.namespace}/${route.service}`,
  }));
}

/**
 * The cloudflare stack is synthesized by cdktn: its whole configuration is
 * the committed `main.tf.json`, with every record a root resource.
 */
async function synthesizedStack(
  tofuCloudflare: string,
): Promise<SynthesizedConfiguration> {
  const synthesized = await readSynthesizedConfiguration(tofuCloudflare);
  if (Object.keys(synthesized.module ?? {}).length > 0)
    throw new Error(
      `${tofuCloudflare} calls a module: its records cannot be read from main.tf.json, so DNS coverage cannot be proven`,
    );
  return synthesized;
}

export async function collectZones(
  tofuCloudflare = TOFU_CLOUDFLARE,
): Promise<Map<string, Zone>> {
  return synthesizedZones(await synthesizedStack(tofuCloudflare));
}

/**
 * Every DNS record of the stack with a literal name: the application records
 * and each zone's baseline, including its `mta-sts` policy host.
 */
export async function collectDnsNames(
  tofuCloudflare = TOFU_CLOUDFLARE,
): Promise<DnsName[]> {
  const configuration = await synthesizedStack(tofuCloudflare);
  const file = path.join(tofuCloudflare, "main.tf.json");
  return synthesizedDnsRecords(configuration).map((record) => ({
    ...record,
    file,
    line: 1,
  }));
}

export function expandCoveredFqdns(
  records: DnsName[],
  zones: Map<string, Zone>,
): Set<string> {
  const covered = new Set<string>();
  for (const r of records) {
    // Always add the bare name — handles the case where TunnelBinding fqdn
    // happens to be just the leftmost label (rare but possible).
    covered.add(r.name);
    if (r.zoneRef !== undefined) {
      const zone = zones.get(r.zoneRef);
      if (zone !== undefined) {
        // Apex (name == zone.name): just the zone fqdn.
        // Subdomain: name + "." + zone.name.
        covered.add(
          r.name === zone.name ? zone.name : `${r.name}.${zone.name}`,
        );
      }
    }
  }
  return covered;
}

export function uncoveredTunnelBindings(
  bindings: readonly TunnelBinding[],
  zones: Map<string, Zone>,
  records: readonly DnsName[],
): TunnelBinding[] {
  const covered = expandCoveredFqdns([...records], zones);
  return bindings.filter((binding) => !covered.has(binding.fqdn));
}

export async function evaluateTunnelDnsCoverage(
  paths: { readonly tofuCloudflare?: string } = {},
): Promise<{
  readonly bindings: TunnelBinding[];
  readonly missing: TunnelBinding[];
}> {
  const bindings = collectTunnelBindings();
  const [zones, records] = await Promise.all([
    collectZones(paths.tofuCloudflare),
    collectDnsNames(paths.tofuCloudflare),
  ]);
  return {
    bindings,
    missing: uncoveredTunnelBindings(bindings, zones, records),
  };
}

async function main(): Promise<void> {
  const { bindings, missing } = await evaluateTunnelDnsCoverage();

  if (missing.length === 0) {
    console.log(
      `✓ tunnel-dns-coverage: all ${String(bindings.length)} TunnelBindings have matching cloudflare_dns_record entries`,
    );
    return;
  }

  console.error(
    `✗ tunnel-dns-coverage: ${String(missing.length)} TunnelBinding${missing.length === 1 ? "" : "s"} without a matching cloudflare_dns_record:\n`,
  );
  for (const m of missing) {
    console.error(
      `  - ${m.fqdn}  (routed to ${m.service} by ${PLATFORM_MODEL})`,
    );
  }
  console.error(
    `\nThe cloudflare stack renders a proxied CNAME to ${tunnelCnameTarget()} for each hostname of the platform model: re-synthesize it (bun run --cwd packages/homelab-cdktn synth) and commit main.tf.json.`,
  );
  process.exit(1);
}

if (import.meta.main) await main();
