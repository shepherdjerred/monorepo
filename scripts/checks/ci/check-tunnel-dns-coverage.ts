#!/usr/bin/env bun

import { Glob } from "bun";
import path from "node:path";
import { DomainRegistrySchema } from "../../../packages/homelab/src/domain-registry.ts";
import {
  readSynthesizedConfiguration,
  type SynthesizedConfiguration,
} from "../../../packages/homelab/scripts/tofu/synthesized-configuration.ts";
import {
  synthesizedBaselineZoneRefs,
  synthesizedDnsRecords,
  synthesizedZones,
} from "./tunnel-dns-synthesized.ts";

const REPO_ROOT = path.resolve(import.meta.dir, "..", "..", "..");
const CDK8S_RESOURCES = path.join(REPO_ROOT, "packages/homelab/src/cdk8s/src");
const TOFU_CLOUDFLARE = path.join(
  REPO_ROOT,
  "packages/homelab/src/tofu/cloudflare",
);

export type TunnelBinding = {
  file: string;
  line: number;
  fqdn: string;
  source: "subdomain" | "fqdn";
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

// Match call sites only: createCloudflareTunnelBinding(<chart>, "<id>", { ... }).
// The opening `{` we want is the one immediately after the second comma. A
// trailing comma after the object argument (`}, )`, as Prettier emits when the
// arg list wraps) is tolerated so such call sites aren't silently skipped.
const TUNNEL_BINDING_REGEX =
  /createCloudflareTunnelBinding\s*\(\s*[A-Za-z_$][\w$.]*\s*,\s*["'`][^"'`]+["'`]\s*,\s*\{([\s\S]*?)\}\s*(?:,\s*)?\)/g;
const SUBDOMAIN_REGEX = /\bsubdomain\s*:\s*["'`]([^"'`]+)["'`]/;
const FQDN_REGEX = /\bfqdn\s*:\s*["'`]([^"'`]+)["'`]/;
// Directive used by call sites whose fqdn comes from a loop variable. Points
// the checker at a sibling file containing the literal hostname list. Example:
//   // @tunnel-dns-coverage:hostnames-from ../resources/s3-static-sites/sites.ts
const HOSTNAMES_FROM_DIRECTIVE =
  /\/\/\s*@tunnel-dns-coverage:hostnames-from\s+(\S+)/;
const MAIL_DOMAINS_FROM_DIRECTIVE =
  /\/\/\s*@tunnel-dns-coverage:mail-domains-from\s+(\S+)/;
const HOSTNAME_LITERAL_REGEX = /\bhostname\s*:\s*["'`]([^"'`]+)["'`]/g;

function computeLineStarts(text: string): number[] {
  const lineStarts: number[] = [0];
  let idx = text.indexOf("\n");
  while (idx !== -1) {
    lineStarts.push(idx + 1);
    idx = text.indexOf("\n", idx + 1);
  }
  return lineStarts;
}

/**
 * Resolve the literal hostnames for a call site whose fqdn comes from a loop
 * variable. Requires a `// @tunnel-dns-coverage:hostnames-from <path>`
 * directive within the {@link PRECEDING_LINES} lines above the call.
 */
async function resolveDynamicHostnames(
  abs: string,
  text: string,
  offset: number,
  line: number,
): Promise<string[]> {
  const PRECEDING_LINES = 5;
  const lineStarts = computeLineStarts(text);
  const callLine = line - 1;
  const windowStart = lineStarts[Math.max(0, callLine - PRECEDING_LINES)] ?? 0;
  const searchWindow = text.slice(windowStart, offset);
  const mailDirective = MAIL_DOMAINS_FROM_DIRECTIVE.exec(searchWindow);
  if (mailDirective?.[1] !== undefined) {
    const sourcePath = path.resolve(path.dirname(abs), mailDirective[1]);
    const registry = DomainRegistrySchema.parse(
      await Bun.file(sourcePath).json(),
    );
    return Object.keys(registry.domains).map((domain) => `mta-sts.${domain}`);
  }
  const directive = HOSTNAMES_FROM_DIRECTIVE.exec(searchWindow);
  if (directive?.[1] === undefined) {
    throw new Error(
      `${abs}:${String(line)}: createCloudflareTunnelBinding without subdomain or fqdn — cannot extract hostname (add a "// @tunnel-dns-coverage:hostnames-from <path>" directive in the ${String(PRECEDING_LINES)} lines immediately above this call if the fqdn is dynamic)`,
    );
  }
  const sourcePath = path.resolve(path.dirname(abs), directive[1]);
  const sourceText = await Bun.file(sourcePath).text();
  const hostnames: string[] = [];
  for (const hostnameMatch of sourceText.matchAll(HOSTNAME_LITERAL_REGEX)) {
    if (hostnameMatch[1] !== undefined) hostnames.push(hostnameMatch[1]);
  }
  return hostnames;
}

export function isScannableTunnelBindingSource(rel: string): boolean {
  return (
    !rel.includes("node_modules") &&
    !rel.includes("generated") &&
    !rel.endsWith(".test.ts")
  );
}

export async function collectTunnelBindings(
  cdk8sResources = CDK8S_RESOURCES,
): Promise<TunnelBinding[]> {
  const bindings: TunnelBinding[] = [];
  const glob = new Glob("**/*.ts");
  for await (const rel of glob.scan({
    cwd: cdk8sResources,
    onlyFiles: true,
  })) {
    if (!isScannableTunnelBindingSource(rel)) continue;
    const abs = path.join(cdk8sResources, rel);
    const text = await Bun.file(abs).text();
    if (!text.includes("createCloudflareTunnelBinding(")) continue;
    for (const match of text.matchAll(TUNNEL_BINDING_REGEX)) {
      const block = match[1];
      if (block === undefined) continue;
      const offset = match.index;
      const line = lineOf(text, offset);
      const sub = SUBDOMAIN_REGEX.exec(block);
      const fqdn = FQDN_REGEX.exec(block);
      if (sub !== null) {
        bindings.push({
          file: abs,
          line,
          fqdn: `${sub[1] ?? ""}.sjer.red`,
          source: "subdomain",
        });
      } else if (fqdn === null) {
        // Non-literal fqdn (e.g. `fqdn: site.hostname` inside a loop). The
        // call site MUST be preceded by a `hostnames-from` directive pointing
        // at a file containing `hostname: "..."` literals. See
        // resolveDynamicHostnames for the directive contract.
        const hostnames = await resolveDynamicHostnames(
          abs,
          text,
          offset,
          line,
        );
        for (const hostname of hostnames) {
          bindings.push({ file: abs, line, fqdn: hostname, source: "fqdn" });
        }
      } else {
        bindings.push({
          file: abs,
          line,
          fqdn: fqdn[1] ?? "",
          source: "fqdn",
        });
      }
    }
  }
  return bindings;
}

/**
 * The cloudflare stack is synthesized by cdktn: its root is the committed
 * `main.tf.json`, and only the modules it calls are HCL.
 */
async function synthesizedStack(
  tofuCloudflare: string,
): Promise<SynthesizedConfiguration> {
  const synthesized = await readSynthesizedConfiguration(tofuCloudflare);
  if (synthesized === undefined)
    throw new Error(
      `${tofuCloudflare} has no main.tf.json: the cloudflare stack is synthesized by packages/homelab-cdktn`,
    );
  return synthesized;
}

export async function collectZones(
  tofuCloudflare = TOFU_CLOUDFLARE,
): Promise<Map<string, Zone>> {
  return synthesizedZones(await synthesizedStack(tofuCloudflare));
}

async function baselineInputs(tofuCloudflare: string) {
  const [moduleText, registry, zones] = await Promise.all([
    Bun.file(
      path.join(tofuCloudflare, "modules/domain-baseline/main.tf"),
    ).text(),
    Bun.file(path.resolve(tofuCloudflare, "../../domain-registry.json"))
      .json()
      .then((value: unknown) => DomainRegistrySchema.parse(value)),
    collectZones(tofuCloudflare),
  ]);
  return { moduleText, registry, zones };
}

/**
 * Every DNS record of the stack: the root's own, and the policy host the HCL
 * baseline module provisions for each registry domain.
 */
export async function collectDnsNames(
  tofuCloudflare = TOFU_CLOUDFLARE,
): Promise<DnsName[]> {
  const configuration = await synthesizedStack(tofuCloudflare);
  const file = path.join(tofuCloudflare, "main.tf.json");
  const names: DnsName[] = synthesizedDnsRecords(configuration).map(
    (record) => ({ ...record, file, line: 1 }),
  );
  if (configuration.module?.["domain_baseline"] !== undefined) {
    const { moduleText, registry, zones } =
      await baselineInputs(tofuCloudflare);
    const domains = Object.keys(registry.domains);
    assertBaselineModuleHost(moduleText);
    names.push(
      ...baselineRecords({
        refs: synthesizedBaselineZoneRefs(configuration, domains),
        domains,
        zones,
        file,
        line: 1,
      }),
    );
  }
  return names;
}

const DNS_RECORD_START_REGEX =
  /resource\s+"cloudflare_dns_record"\s+"([^"]+)"\s*\{/g;

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

function extractDnsRecordBlocks(
  text: string,
): { resourceName: string; body: string; offset: number }[] {
  const blocks: { resourceName: string; body: string; offset: number }[] = [];

  for (const match of text.matchAll(DNS_RECORD_START_REGEX)) {
    const resourceName = match[1];
    if (resourceName === undefined) continue;

    let depth = 1;
    let quote: '"' | "'" | undefined;
    let escaped = false;
    const bodyStart = match.index + match[0].length;

    for (let index = bodyStart; index < text.length; index += 1) {
      const char = text[index];
      if (char === undefined) continue;

      if (quote !== undefined) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === quote) {
          quote = undefined;
        }
        continue;
      }

      switch (char) {
        case '"':
        case "'": {
          quote = char;
          break;
        }
        case "{": {
          depth += 1;
          break;
        }
        case "}": {
          depth -= 1;
          if (depth === 0) {
            blocks.push({
              resourceName,
              body: text.slice(bodyStart, index),
              offset: match.index,
            });
          }
          break;
        }
        // No default
      }
      if (depth === 0) break;
    }

    if (depth !== 0) {
      throw new Error(
        `Unclosed cloudflare_dns_record resource ${resourceName} starting at line ${String(lineOf(text, match.index))}`,
      );
    }
  }

  return blocks;
}

/** The local HCL module must provision the policy host for every instance. */
function assertBaselineModuleHost(moduleText: string): void {
  const host = extractDnsRecordBlocks(moduleText).find(
    (block) => block.resourceName === "mta_sts_host",
  );
  if (
    host === undefined ||
    ![
      /^\s*zone_id\s*=\s*var\.zone_id\s*$/m,
      /^\s*name\s*=\s*"mta-sts"\s*$/m,
      /^\s*type\s*=\s*"CNAME"\s*$/m,
      /^\s*content\s*=\s*"3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"\s*$/m,
      /^\s*proxied\s*=\s*true\s*$/m,
    ].every((field) => field.test(host.body)) ||
    /\b(?:count|for_each)\s*=/.test(host.body)
  ) {
    throw new Error(
      "domain_baseline must provision an unconditional proxied mta-sts Tunnel CNAME",
    );
  }
}

/** One covered `mta-sts` record per registry domain, once every zone is bound exactly once. */
function baselineRecords(input: {
  refs: Map<string, string>;
  domains: string[];
  zones: Map<string, Zone>;
  file: string;
  line: number;
}): DnsName[] {
  const { refs, domains, zones, file, line } = input;
  if (
    refs.size !== domains.length ||
    zones.size !== domains.length ||
    domains.some((domain) => zones.get(refs.get(domain) ?? "")?.name !== domain)
  ) {
    throw new Error(
      "Every managed Cloudflare zone needs exactly one matching domain registry and baseline binding",
    );
  }
  return domains.map((domain) => ({
    file,
    line,
    resourceName: `module.domain_baseline["${domain}"].cloudflare_dns_record.mta_sts_host`,
    name: "mta-sts",
    zoneRef: refs.get(domain),
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
  paths: {
    readonly cdk8sResources?: string;
    readonly tofuCloudflare?: string;
  } = {},
): Promise<{
  readonly bindings: TunnelBinding[];
  readonly missing: TunnelBinding[];
}> {
  const [bindings, zones, records] = await Promise.all([
    collectTunnelBindings(paths.cdk8sResources),
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
    const rel = path.relative(REPO_ROOT, m.file);
    console.error(
      `  - ${m.fqdn}  (declared in ${rel}:${String(m.line)} via ${m.source})`,
    );
  }
  console.error(
    "\nAdd a proxied CNAME to 3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com for each in the cloudflare stack (packages/homelab-cdktn/src/stacks/cloudflare), then re-synthesize.",
  );
  process.exit(1);
}

if (import.meta.main) await main();
