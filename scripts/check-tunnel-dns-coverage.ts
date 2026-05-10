#!/usr/bin/env bun

import { Glob } from "bun";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dir, "..");
const CDK8S_RESOURCES = path.join(REPO_ROOT, "packages/homelab/src/cdk8s/src");
const TOFU_CLOUDFLARE = path.join(
  REPO_ROOT,
  "packages/homelab/src/tofu/cloudflare",
);

type TunnelBinding = {
  file: string;
  line: number;
  fqdn: string;
  source: "subdomain" | "fqdn";
};

type DnsName = {
  file: string;
  line: number;
  resourceName: string;
  /** The literal `name = "..."` value */
  name: string;
  /** Zone resource name (e.g. `cloudflare_zone.sjer_red.id`), if discoverable */
  zoneRef: string | undefined;
};

type Zone = {
  /** The HCL resource label, e.g. `sjer_red` */
  ref: string;
  /** The FQDN of the zone, e.g. `sjer.red` */
  name: string;
};

// Match call sites only: createCloudflareTunnelBinding(<chart>, "<id>", { ... }).
// The opening `{` we want is the one immediately after the second comma.
const TUNNEL_BINDING_REGEX =
  /createCloudflareTunnelBinding\s*\(\s*[A-Za-z_$][\w$.]*\s*,\s*["'`][^"'`]+["'`]\s*,\s*\{([\s\S]*?)\}\s*\)/g;
const SUBDOMAIN_REGEX = /\bsubdomain\s*:\s*["'`]([^"'`]+)["'`]/;
const FQDN_REGEX = /\bfqdn\s*:\s*["'`]([^"'`]+)["'`]/;

const ZONE_REGEX =
  /resource\s+"cloudflare_zone"\s+"([^"]+)"\s*\{[\s\S]*?name\s*=\s*"([^"]+)"/g;
const DNS_RECORD_START_REGEX =
  /resource\s+"cloudflare_dns_record"\s+"([^"]+)"\s*\{/g;
const DNS_NAME_FIELD = /^\s*name\s*=\s*"([^"]+)"/m;
const DNS_ZONE_ID_FIELD = /zone_id\s*=\s*cloudflare_zone\.([A-Za-z0-9_]+)\.id/;

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

function extractDnsRecordBlocks(
  text: string,
): { resourceName: string; body: string; offset: number }[] {
  const blocks: { resourceName: string; body: string; offset: number }[] = [];

  for (const match of text.matchAll(DNS_RECORD_START_REGEX)) {
    const resourceName = match[1];
    if (resourceName === undefined || match.index === undefined) continue;

    let depth = 1;
    let quote: '"' | "'" | undefined;
    let escaped = false;
    const bodyStart = match.index + match[0].length;

    for (let index = bodyStart; index < text.length; index += 1) {
      const char = text[index];

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

      if (char === '"' || char === "'") {
        quote = char;
      } else if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          blocks.push({
            resourceName,
            body: text.slice(bodyStart, index),
            offset: match.index,
          });
          break;
        }
      }
    }

    if (depth !== 0) {
      throw new Error(
        `Unclosed cloudflare_dns_record resource ${resourceName} starting at line ${String(lineOf(text, match.index))}`,
      );
    }
  }

  return blocks;
}

async function collectTunnelBindings(): Promise<TunnelBinding[]> {
  const bindings: TunnelBinding[] = [];
  const glob = new Glob("**/*.ts");
  for await (const rel of glob.scan({
    cwd: CDK8S_RESOURCES,
    onlyFiles: true,
  })) {
    if (rel.includes("node_modules") || rel.includes("generated")) continue;
    const abs = path.join(CDK8S_RESOURCES, rel);
    const text = await Bun.file(abs).text();
    if (!text.includes("createCloudflareTunnelBinding(")) continue;
    for (const match of text.matchAll(TUNNEL_BINDING_REGEX)) {
      const block = match[1];
      if (block === undefined) continue;
      const offset = match.index ?? 0;
      const line = lineOf(text, offset);
      const sub = SUBDOMAIN_REGEX.exec(block);
      const fqdn = FQDN_REGEX.exec(block);
      if (sub !== null) {
        bindings.push({
          file: abs,
          line,
          fqdn: `${sub[1]}.sjer.red`,
          source: "subdomain",
        });
      } else if (fqdn !== null) {
        bindings.push({
          file: abs,
          line,
          fqdn: fqdn[1] ?? "",
          source: "fqdn",
        });
      } else {
        throw new Error(
          `${abs}:${String(line)}: createCloudflareTunnelBinding without subdomain or fqdn — cannot extract hostname`,
        );
      }
    }
  }
  return bindings;
}

async function collectZones(): Promise<Map<string, Zone>> {
  const zones = new Map<string, Zone>();
  const glob = new Glob("*.tf");
  for await (const rel of glob.scan({
    cwd: TOFU_CLOUDFLARE,
    onlyFiles: true,
  })) {
    const abs = path.join(TOFU_CLOUDFLARE, rel);
    const text = await Bun.file(abs).text();
    for (const match of text.matchAll(ZONE_REGEX)) {
      const ref = match[1];
      const name = match[2];
      if (ref === undefined || name === undefined) continue;
      zones.set(ref, { ref, name });
    }
  }
  return zones;
}

async function collectDnsNames(): Promise<DnsName[]> {
  const names: DnsName[] = [];
  const glob = new Glob("*.tf");
  for await (const rel of glob.scan({
    cwd: TOFU_CLOUDFLARE,
    onlyFiles: true,
  })) {
    const abs = path.join(TOFU_CLOUDFLARE, rel);
    const text = await Bun.file(abs).text();
    for (const block of extractDnsRecordBlocks(text)) {
      const nameMatch = DNS_NAME_FIELD.exec(block.body);
      const zoneMatch = DNS_ZONE_ID_FIELD.exec(block.body);
      if (nameMatch === null) continue;
      names.push({
        file: abs,
        line: lineOf(text, block.offset),
        resourceName: block.resourceName,
        name: nameMatch[1] ?? "",
        zoneRef: zoneMatch?.[1],
      });
    }
  }
  return names;
}

function expandCoveredFqdns(
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

async function main(): Promise<void> {
  const [bindings, zones, records] = await Promise.all([
    collectTunnelBindings(),
    collectZones(),
    collectDnsNames(),
  ]);

  const covered = expandCoveredFqdns(records, zones);
  const missing = bindings.filter((b) => !covered.has(b.fqdn));

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
    `\nAdd a matching block to packages/homelab/src/tofu/cloudflare/<zone>.tf:\n`,
  );
  const example = missing[0];
  if (example !== undefined) {
    const labels = example.fqdn.split(".");
    const subdomain = labels[0] ?? example.fqdn;
    console.error(
      `  resource "cloudflare_dns_record" "sjer_red_cname_${subdomain.replace(/-/g, "_")}" {\n    zone_id = cloudflare_zone.sjer_red.id\n    ttl     = 1\n    name    = "${subdomain}"\n    type    = "CNAME"\n    content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"\n    proxied = true\n  }`,
    );
  }
  process.exit(1);
}

if (import.meta.main) {
  await main();
}
