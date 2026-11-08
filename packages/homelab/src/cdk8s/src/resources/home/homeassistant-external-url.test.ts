import path from "node:path";
import { expect, test } from "vitest";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

// Remote MCP OAuth clients need HA's authorization-server metadata to carry an
// issuer and absolute endpoints, which HA emits only for a configured URL that
// matches the public Cloudflare Tunnel hostname.
const CoreConfigurationSchema = z.object({
  homeassistant: z.object({
    external_url: z.string(),
    internal_url: z.string().optional(),
  }),
});

test("Home Assistant advertises its public tunnel hostname as the external URL", async () => {
  const configurationPath = path.join(
    import.meta.dir,
    "../../../config/homeassistant/configuration.yaml",
  );
  const configuration = CoreConfigurationSchema.parse(
    parseYaml(await Bun.file(configurationPath).text(), {
      customTags: [{ tag: "!include", resolve: (value: string) => value }],
    }),
  );
  expect(configuration.homeassistant.external_url).toBe(
    "https://homeassistant.sjer.red",
  );
  // LAN media players fetch from the detected LAN address.
  expect(configuration.homeassistant.internal_url).toBeUndefined();
});
