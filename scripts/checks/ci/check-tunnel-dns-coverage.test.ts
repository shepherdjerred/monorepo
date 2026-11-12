import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

import {
  collectDnsNames,
  collectZones,
  evaluateTunnelDnsCoverage,
  uncoveredTunnelBindings,
  type DnsName,
  type TunnelBinding,
  type Zone,
} from "./check-tunnel-dns-coverage.ts";

const cloudflare = fileURLToPath(
  new URL("../../../packages/homelab/src/tofu/cloudflare/", import.meta.url),
);

describe("tunnel DNS coverage", () => {
  test("resolves the production mail policy bindings against each zone's baseline record", async () => {
    const result = await evaluateTunnelDnsCoverage();
    expect(result.missing).toEqual([]);
    const mail = result.bindings.filter((binding) =>
      binding.fqdn.startsWith("mta-sts."),
    );
    const zones = await collectZones(cloudflare);
    expect(mail.map((binding) => binding.fqdn).sort()).toEqual(
      [...zones.values()].map((zone) => `mta-sts.${zone.name}`).sort(),
    );
  });

  test("a stack without a synthesized root is refused rather than read as empty", async () => {
    const empty = await mkdtemp(path.join(tmpdir(), "tunnel-dns-empty-"));
    try {
      await expect(collectZones(empty)).rejects.toThrow("has no main.tf.json");
      await expect(collectDnsNames(empty)).rejects.toThrow(
        "has no main.tf.json",
      );
    } finally {
      await rm(empty, { recursive: true });
    }
  });

  test("reports the exact uncovered production hostname and its route", () => {
    const bindings: TunnelBinding[] = [
      { fqdn: "missing.sjer.red", service: "caddy/caddy" },
    ];
    expect(
      uncoveredTunnelBindings(bindings, new Map<string, Zone>(), []),
    ).toEqual(bindings);
  });

  test("accepts an FQDN covered by its Cloudflare zone record", () => {
    const bindings: TunnelBinding[] = [
      { fqdn: "app.sjer.red", service: "caddy/caddy" },
    ];
    const zones = new Map<string, Zone>([
      ["sjer_red", { ref: "sjer_red", name: "sjer.red" }],
    ]);
    const records: DnsName[] = [
      {
        file: "/repo/packages/homelab/src/tofu/cloudflare/main.tf.json",
        line: 1,
        resourceName: "app",
        name: "app",
        zoneRef: "sjer_red",
      },
    ];
    expect(uncoveredTunnelBindings(bindings, zones, records)).toEqual([]);
  });
});

type FixtureConfiguration = {
  module?: Record<string, Record<string, unknown>>;
  resource: Record<string, Record<string, Record<string, unknown>>>;
};

/**
 * A copy of the committed cloudflare stack reduced to what coverage reads:
 * its zones and records.
 */
async function synthesizedFixture(
  edit?: (configuration: FixtureConfiguration) => void,
) {
  const root = await mkdtemp(path.join(tmpdir(), "tunnel-dns-json-"));
  const stack = path.join(root, "src/tofu/cloudflare");
  await mkdir(stack, { recursive: true });
  const zones = await collectZones(cloudflare);
  const records = await collectDnsNames(cloudflare);
  const configuration: FixtureConfiguration = {
    resource: {
      cloudflare_zone: Object.fromEntries(
        [...zones.values()].map((zone) => [
          zone.ref,
          { name: zone.name, account: { id: "${var.cloudflare_account_id}" } },
        ]),
      ),
      cloudflare_dns_record: Object.fromEntries(
        records.map((record) => [
          record.resourceName,
          {
            name: record.name,
            ...(record.zoneRef === undefined
              ? {}
              : { zone_id: `\${cloudflare_zone.${record.zoneRef}.id}` }),
          },
        ]),
      ),
    },
  };
  edit?.(configuration);
  await Bun.write(
    path.join(stack, "main.tf.json"),
    JSON.stringify(configuration),
  );
  return { root, stack };
}

const coverage = (records: DnsName[]) =>
  records
    .map(
      (record) =>
        `${record.resourceName} ${record.name} ${record.zoneRef ?? "-"}`,
    )
    .sort();

describe("tunnel DNS coverage of a synthesized cloudflare stack", () => {
  const scratch: string[] = [];
  afterEach(async () => {
    await Promise.all(
      scratch.splice(0).map((directory) => rm(directory, { recursive: true })),
    );
  });
  test("reads zones, application records and each baseline's policy host from main.tf.json", async () => {
    const { root, stack } = await synthesizedFixture();
    scratch.push(root);
    expect(await collectZones(stack)).toEqual(await collectZones(cloudflare));
    const fromJson = await collectDnsNames(stack);
    expect(fromJson.length).toBeGreaterThan(250);
    expect(coverage(fromJson)).toEqual(
      coverage(await collectDnsNames(cloudflare)),
    );
    expect(coverage(fromJson)).toEqual(
      expect.arrayContaining([
        "sjer_red_cname_argocd argocd sjer_red",
        "sjer_red_baseline_mta_sts_host mta-sts sjer_red",
        "ts_mc_net_baseline_mta_sts_host mta-sts ts_mc_net",
      ]),
    );
    // A for_each record's name is an expression: it covers no hostname.
    expect(
      fromJson.some((record) => record.resourceName === "dmarc_report"),
    ).toBe(false);
    const evaluated = await evaluateTunnelDnsCoverage({
      tofuCloudflare: stack,
    });
    expect(evaluated.missing).toEqual([]);
  });

  test("fails when a zone loses its policy host or a hostname loses its record", async () => {
    for (const removed of [
      "sjer_red_baseline_mta_sts_host",
      "sjer_red_cname_argocd",
    ]) {
      const { root, stack } = await synthesizedFixture((configuration) => {
        const records = configuration.resource["cloudflare_dns_record"];
        if (records !== undefined) Reflect.deleteProperty(records, removed);
      });
      scratch.push(root);
      const evaluated = await evaluateTunnelDnsCoverage({
        tofuCloudflare: stack,
      });
      expect(evaluated.missing.map((binding) => binding.fqdn)).toEqual([
        removed === "sjer_red_cname_argocd"
          ? "argocd.sjer.red"
          : "mta-sts.sjer.red",
      ]);
    }
  });

  test("refuses a stack that calls a module, whose records it cannot read", async () => {
    const { root, stack } = await synthesizedFixture((configuration) => {
      configuration.module = {
        domain_baseline: { source: "./modules/domain-baseline" },
      };
    });
    scratch.push(root);
    await expect(collectDnsNames(stack)).rejects.toThrow(
      "DNS coverage cannot be proven",
    );
  });
});
