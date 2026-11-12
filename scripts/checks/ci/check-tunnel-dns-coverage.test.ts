import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { DomainRegistrySchema } from "../../../packages/homelab/src/domain-registry.ts";

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
  test("resolves the production mail policy bindings against actual module DNS", async () => {
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
  locals: Record<string, unknown>;
  module: Record<string, Record<string, unknown>>;
  resource: Record<string, Record<string, Record<string, unknown>>>;
};

/**
 * A copy of the committed cloudflare stack reduced to what coverage reads:
 * its zones, records and baseline module call, and the HCL baseline module.
 */
async function synthesizedFixture(
  edit?: (configuration: FixtureConfiguration) => void,
  editModule: (module: string) => string = (module) => module,
) {
  const root = await mkdtemp(path.join(tmpdir(), "tunnel-dns-json-"));
  const stack = path.join(root, "src/tofu/cloudflare");
  await mkdir(path.join(stack, "modules/domain-baseline"), { recursive: true });
  await Bun.write(
    path.join(stack, "modules/domain-baseline/main.tf"),
    editModule(
      await Bun.file(`${cloudflare}/modules/domain-baseline/main.tf`).text(),
    ),
  );
  await cp(
    `${cloudflare}/../../domain-registry.json`,
    path.join(root, "src/domain-registry.json"),
  );
  const zones = await collectZones(cloudflare);
  const allRecords = await collectDnsNames(cloudflare);
  const records = allRecords.filter(
    (record) => !record.resourceName.startsWith("module."),
  );
  const baseline: Record<string, unknown> = {
    source: "./modules/domain-baseline",
    for_each: "${local.domain_registry.domains}",
    zone_id: "${local.baseline_zone_ids[each.key]}",
    domain: "${each.key}",
  };
  const configuration: FixtureConfiguration = {
    locals: {
      domain_registry:
        '${jsondecode(file("${path.module}/../../domain-registry.json"))}',
      baseline_zone_ids: Object.fromEntries(
        [...zones.values()].map((zone) => [
          zone.name,
          `\${cloudflare_zone.${zone.ref}.id}`,
        ]),
      ),
    },
    module: {
      domain_baseline: baseline,
    },
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
  test("reads zones, root records and the baseline module's policy hosts from main.tf.json", async () => {
    const { root, stack } = await synthesizedFixture();
    scratch.push(root);
    expect(await collectZones(stack)).toEqual(await collectZones(cloudflare));
    const fromJson = await collectDnsNames(stack);
    expect(fromJson.length).toBeGreaterThan(50);
    expect(coverage(fromJson)).toEqual(
      coverage(await collectDnsNames(cloudflare)),
    );
    expect(coverage(fromJson)).toEqual(
      expect.arrayContaining([
        "sjer_red_cname_argocd argocd sjer_red",
        'module.domain_baseline["sjer.red"].cloudflare_dns_record.mta_sts_host mta-sts sjer_red',
        'module.domain_baseline["ts-mc.net"].cloudflare_dns_record.mta_sts_host mta-sts ts_mc_net',
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

  test("fails when the module stops provisioning the policy CNAME", async () => {
    for (const editModule of [
      (module: string) => module.replace('"mta_sts_host"', '"deleted_host"'),
      (module: string) =>
        module.replace('name    = "mta-sts"', 'name    = "wrong-host"'),
      (module: string) =>
        module.replace(
          'resource "cloudflare_dns_record" "mta_sts_host" {',
          'resource "cloudflare_dns_record" "mta_sts_host" {\n  count = 0',
        ),
    ]) {
      const { root, stack } = await synthesizedFixture(undefined, editModule);
      scratch.push(root);
      await expect(collectDnsNames(stack)).rejects.toThrow(
        "unconditional proxied mta-sts",
      );
    }
  });

  test("fails when a managed zone lacks an inventory entry", async () => {
    const { root, stack } = await synthesizedFixture((configuration) => {
      const zones = configuration.resource["cloudflare_zone"];
      if (zones !== undefined)
        zones["forgotten_com"] = { name: "forgotten.com" };
    });
    scratch.push(root);
    await expect(collectDnsNames(stack)).rejects.toThrow(
      "Every managed Cloudflare zone",
    );
  });

  test("accepts baseline instances the TypeScript stack imported as a literal map", async () => {
    const registry = DomainRegistrySchema.parse(
      await Bun.file(`${cloudflare}/../../domain-registry.json`).json(),
    );
    const { root, stack } = await synthesizedFixture((configuration) => {
      delete configuration.locals["domain_registry"];
      const module = configuration.module["domain_baseline"];
      if (module !== undefined) module["for_each"] = registry.domains;
    });
    scratch.push(root);
    expect(coverage(await collectDnsNames(stack))).toEqual(
      coverage(await collectDnsNames(cloudflare)),
    );
  });

  test("fails when the synthesized baseline wiring cannot be proven", async () => {
    for (const edit of [
      (configuration: FixtureConfiguration) => {
        const module = configuration.module["domain_baseline"];
        if (module !== undefined) module["count"] = 1;
      },
      (configuration: FixtureConfiguration) => {
        const module = configuration.module["domain_baseline"];
        if (module !== undefined) module["for_each"] = { "sjer.red": {} };
      },
    ]) {
      const { root, stack } = await synthesizedFixture(edit);
      scratch.push(root);
      await expect(collectDnsNames(stack)).rejects.toThrow(
        "Unsupported domain_baseline wiring",
      );
    }
    const unbound = await synthesizedFixture((configuration) => {
      const zoneIds = configuration.locals["baseline_zone_ids"];
      if (typeof zoneIds === "object" && zoneIds !== null)
        Reflect.deleteProperty(zoneIds, "sjer.red");
    });
    scratch.push(unbound.root);
    await expect(collectDnsNames(unbound.stack)).rejects.toThrow(
      "Every managed Cloudflare zone",
    );
  });
});
