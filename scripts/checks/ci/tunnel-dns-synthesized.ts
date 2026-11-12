/**
 * Zones and DNS records of a cloudflare stack synthesized by cdktn
 * (`main.tf.json`), for check-tunnel-dns-coverage.ts.
 */
import {
  literalAttribute,
  referencedResource,
  synthesizedResources,
  type SynthesizedConfiguration,
} from "../../../packages/homelab/scripts/tofu/synthesized-configuration.ts";

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
