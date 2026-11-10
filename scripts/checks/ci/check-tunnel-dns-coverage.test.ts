import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { DomainRegistrySchema } from "../../../packages/homelab/src/domain-registry.ts";

import {
  baselineDnsNames,
  collectDnsNames,
  collectZones,
  evaluateTunnelDnsCoverage,
  isScannableTunnelBindingSource,
  uncoveredTunnelBindings,
  type DnsName,
  type TunnelBinding,
  type Zone,
} from "./check-tunnel-dns-coverage.ts";

const cloudflare = fileURLToPath(
  new URL("../../../packages/homelab/src/tofu/cloudflare/", import.meta.url),
);

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

/**
 * The cloudflare stack as cdktn would synthesize it address-identically:
 * the same zones, records and baseline module call, in JSON syntax.
 */
async function synthesizedFixture(
  edit?: (configuration: {
    locals: Record<string, unknown>;
    module: Record<string, Record<string, unknown>>;
  }) => void,
) {
  const root = await mkdtemp(path.join(tmpdir(), "tunnel-dns-json-"));
  const stack = path.join(root, "src/tofu/cloudflare");
  await mkdir(path.join(stack, "modules/domain-baseline"), { recursive: true });
  await cp(
    `${cloudflare}/modules/domain-baseline/main.tf`,
    path.join(stack, "modules/domain-baseline/main.tf"),
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
  const configuration = {
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

// An interpolated HCL record name covers no hostname; the JSON reader skips it.
const coverage = (records: DnsName[]) =>
  records
    .filter((record) => !record.name.includes("${"))
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
  test("reads the same zones, records and baseline hosts from main.tf.json as from HCL", async () => {
    const { root, stack } = await synthesizedFixture();
    scratch.push(root);
    expect(await collectZones(stack)).toEqual(await collectZones(cloudflare));
    const fromJson = await collectDnsNames(stack);
    expect(fromJson.length).toBeGreaterThan(50);
    expect(coverage(fromJson)).toEqual(
      coverage(await collectDnsNames(cloudflare)),
    );
    const evaluated = await evaluateTunnelDnsCoverage({
      tofuCloudflare: stack,
    });
    expect(evaluated.missing).toEqual([]);
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
      (configuration: { module: Record<string, Record<string, unknown>> }) => {
        const module = configuration.module["domain_baseline"];
        if (module !== undefined) module["count"] = 1;
      },
      (configuration: { module: Record<string, Record<string, unknown>> }) => {
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
