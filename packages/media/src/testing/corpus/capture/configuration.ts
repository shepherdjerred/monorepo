import { z } from "zod";
import type { InventorySource } from "#migration/source-inventory.ts";

const Instance = z.object({
  base_url: z.url(),
  api_key: z.string().min(1).max(4096),
});
const Config = z.object({
  radarr: z.record(z.string(), Instance),
  sonarr: z.record(z.string(), Instance),
});

export function assertRecyclarrReference(reference: string) {
  // Require an exact item ID, never a potentially ambiguous login title.
  if (!/^op:\/\/[^/]+\/[a-z0-9]{26}\/recyclarr\.yaml$/u.test(reference))
    throw new Error("Exact Recyclarr item ID and field reference required");
}
export function captureSources(
  yaml: string,
  overrides: { radarr: string; sonarr: string },
): InventorySource[] {
  if (Buffer.byteLength(yaml) > 1_000_000)
    throw new Error("Credential configuration exceeds bound");
  const config = Config.parse(Bun.YAML.parse(yaml));
  return (["radarr", "sonarr"] as const).map((source) => {
    const instances = Object.values(config[source]);
    const instance = instances[0];
    if (instance === undefined || instances.length !== 1)
      throw new Error("Exactly one configured instance required per source");
    const url = new URL(overrides[source]);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.port === "" ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== ""
    )
      throw new Error("Reviewed explicit loopback port-forward required");
    return { source, baseUrl: url.toString(), apiKey: instance.api_key };
  });
}
