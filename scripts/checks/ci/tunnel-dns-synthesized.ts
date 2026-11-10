/**
 * Zones, DNS records and the `domain_baseline` wiring of a cloudflare stack
 * synthesized by cdktn (`main.tf.json`), for check-tunnel-dns-coverage.ts.
 */
import { z } from "zod";
import {
  literalAttribute,
  referencedResource,
  synthesizedResources,
  type SynthesizedConfiguration,
} from "../../../packages/homelab/scripts/tofu/synthesized-configuration.ts";

const RecordSchema = z.record(z.string(), z.unknown());
const UNPROVEN =
  "Unsupported domain_baseline wiring: DNS coverage cannot be proven";

/** The baseline module call, when it is wired the one way coverage can be proven. */
const BaselineModuleSchema = z.looseObject({
  source: z.literal("./modules/domain-baseline"),
  count: z.undefined().optional(),
  zone_id: z.literal("${local.baseline_zone_ids[each.key]}"),
  domain: z.literal("${each.key}"),
  for_each: z.union([z.string(), RecordSchema]),
});

/**
 * Zone resource per registry domain for a synthesized root that still calls
 * the local HCL baseline module, once its wiring is the one coverage can be
 * proven for: one instance per registry domain, each bound to that domain's
 * zone. The instances come either from the registry file read at plan time
 * (`local.domain_registry.domains`, as the HCL root does) or from a literal
 * map the TypeScript stack imported, whose keys must equal the registry's.
 */
export function synthesizedBaselineZoneRefs(
  configuration: SynthesizedConfiguration,
  domains: readonly string[],
): Map<string, string> {
  const locals = configuration.locals ?? {};
  const module = BaselineModuleSchema.safeParse(
    configuration.module?.["domain_baseline"],
  );
  const zoneIds = RecordSchema.safeParse(locals["baseline_zone_ids"]);
  if (!module.success || !zoneIds.success) throw new Error(UNPROVEN);
  const instances = module.data.for_each;
  const registryFile = locals["domain_registry"];
  const proven =
    typeof instances === "string"
      ? instances === "${local.domain_registry.domains}" &&
        typeof registryFile === "string" &&
        registryFile.includes(
          'file("${path.module}/../../domain-registry.json")',
        )
      : Object.keys(instances).toSorted().join("\n") ===
        [...domains].toSorted().join("\n");
  if (!proven) throw new Error(UNPROVEN);
  const refs = new Map<string, string>();
  for (const [domain, zoneId] of Object.entries(zoneIds.data)) {
    const ref = referencedResource(zoneId, "cloudflare_zone");
    if (ref !== undefined) refs.set(domain, ref);
  }
  return refs;
}

/** Zone FQDN by `cloudflare_zone` resource name. */
export function synthesizedZones(
  configuration: SynthesizedConfiguration,
): Map<string, { ref: string; name: string }> {
  const zones = new Map<string, { ref: string; name: string }>();
  for (const zone of synthesizedResources(configuration, "cloudflare_zone")) {
    const name = literalAttribute(zone.attributes, "name");
    if (name !== undefined) zones.set(zone.name, { ref: zone.name, name });
  }
  return zones;
}

/** Every `cloudflare_dns_record` with a literal name, and the zone it references. */
export function synthesizedDnsRecords(
  configuration: SynthesizedConfiguration,
): { resourceName: string; name: string; zoneRef: string | undefined }[] {
  return synthesizedResources(configuration, "cloudflare_dns_record").flatMap(
    (record) => {
      const name = literalAttribute(record.attributes, "name");
      return name === undefined
        ? []
        : [
            {
              resourceName: record.name,
              name,
              zoneRef: referencedResource(
                record.attributes["zone_id"],
                "cloudflare_zone",
              ),
            },
          ];
    },
  );
}
