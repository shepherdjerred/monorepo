import { describe, expect, test } from "vitest";

import {
  baselineDnsNames,
  collectZones,
  evaluateTunnelDnsCoverage,
  isScannableTunnelBindingSource,
  uncoveredTunnelBindings,
  type DnsName,
  type TunnelBinding,
  type Zone,
} from "./check-tunnel-dns-coverage.ts";

const cloudflare = new URL(
  "../../../packages/homelab/src/tofu/cloudflare/",
  import.meta.url,
).pathname;

async function baselineFixture() {
  const [root, module, registry, zones] = await Promise.all([
    Bun.file(`${cloudflare}/domain-baseline.tf`).text(),
    Bun.file(`${cloudflare}/modules/domain-baseline/main.tf`).text(),
    Bun.file(`${cloudflare}/../../domain-registry.json`)
      .json()
      .then((value: unknown) => value),
    collectZones(cloudflare),
  ]);
  return { root, module, registry, zones };
}

describe("tunnel DNS coverage", () => {
  test("resolves the production mail policy bindings against actual module DNS", async () => {
    const result = await evaluateTunnelDnsCoverage();
    expect(result.missing).toEqual([]);
    const mail = result.bindings.filter((binding) =>
      binding.fqdn.startsWith("mta-sts."),
    );
    const { zones } = await baselineFixture();
    expect(mail.map((binding) => binding.fqdn).sort()).toEqual(
      [...zones.values()].map((zone) => `mta-sts.${zone.name}`).sort(),
    );
  });

  test("fails when the module stops provisioning the policy CNAME", async () => {
    const f = await baselineFixture();
    for (const module of [
      f.module.replace('"mta_sts_host"', '"deleted_host"'),
      f.module.replace('name    = "mta-sts"', 'name    = "wrong-host"'),
      f.module.replace(
        'resource "cloudflare_dns_record" "mta_sts_host" {',
        'resource "cloudflare_dns_record" "mta_sts_host" {\n  count = 0',
      ),
    ]) {
      expect(() =>
        baselineDnsNames(f.root, module, f.registry, {
          zones: f.zones,
          file: "fixture.tf",
        }),
      ).toThrow("unconditional proxied mta-sts");
    }
  });

  test("fails when a managed zone lacks an inventory entry or binding", async () => {
    const f = await baselineFixture();
    const zones = new Map(f.zones);
    zones.set("forgotten_com", { ref: "forgotten_com", name: "forgotten.com" });
    expect(() =>
      baselineDnsNames(f.root, f.module, f.registry, {
        zones,
        file: "fixture.tf",
      }),
    ).toThrow("Every managed Cloudflare zone");
    expect(() =>
      baselineDnsNames(
        f.root.replace(/\s*"sjer.red"\s*=\s*cloudflare_zone.sjer_red.id/, ""),
        f.module,
        f.registry,
        { zones: f.zones, file: "fixture.tf" },
      ),
    ).toThrow("Every managed Cloudflare zone");
  });

  test("ignores test fixtures while retaining production TypeScript sources", () => {
    expect(isScannableTunnelBindingSource("resources/caddy.test.ts")).toBe(
      false,
    );
    expect(isScannableTunnelBindingSource("resources/caddy.ts")).toBe(true);
  });

  test("reports the exact uncovered production hostname and declaration path", () => {
    const bindings: TunnelBinding[] = [
      {
        file: "/repo/packages/homelab/src/cdk8s/src/resources/caddy.ts",
        line: 31,
        fqdn: "missing.sjer.red",
        source: "subdomain",
      },
    ];
    expect(
      uncoveredTunnelBindings(bindings, new Map<string, Zone>(), []),
    ).toEqual(bindings);
  });

  test("accepts an FQDN covered by its Cloudflare zone record", () => {
    const bindings: TunnelBinding[] = [
      {
        file: "/repo/packages/homelab/src/cdk8s/src/resources/caddy.ts",
        line: 31,
        fqdn: "app.sjer.red",
        source: "subdomain",
      },
    ];
    const zones = new Map<string, Zone>([
      ["sjer_red", { ref: "sjer_red", name: "sjer.red" }],
    ]);
    const records: DnsName[] = [
      {
        file: "/repo/packages/homelab/src/tofu/cloudflare/sjer-red.tf",
        line: 8,
        resourceName: "app",
        name: "app",
        zoneRef: "sjer_red",
      },
    ];
    expect(uncoveredTunnelBindings(bindings, zones, records)).toEqual([]);
  });
});
