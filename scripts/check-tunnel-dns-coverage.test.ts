import { describe, expect, test } from "bun:test";

import {
  isScannableTunnelBindingSource,
  uncoveredTunnelBindings,
  type DnsName,
  type TunnelBinding,
  type Zone,
} from "./check-tunnel-dns-coverage.ts";

describe("tunnel DNS coverage", () => {
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
