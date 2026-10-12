import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  citizens,
  coreProtect,
  luckPerms,
  multiverseCore,
  paper,
  worldEdit,
} from "#src/pins.ts";

const PluginsJsonSchema = z.object({
  paper: z.object({ version: z.string(), url: z.string(), sha256: z.string() }),
  plugins: z.array(
    z.object({
      name: z.string(),
      version: z.string(),
      url: z.string(),
      sha256: z.string(),
    }),
  ),
});

const pluginsJson = path.resolve(
  import.meta.dirname,
  "../../the-storm/server/plugins.json",
);

describe("pins", () => {
  it("match the production the-storm-server image", async () => {
    const shipped = PluginsJsonSchema.parse(
      JSON.parse(await Bun.file(pluginsJson).text()),
    );
    expect(shipped.paper).toMatchObject({
      version: `${paper.version}-${paper.build.toString()}`,
      url: paper.url,
      sha256: paper.sha256,
    });
    for (const pin of [
      worldEdit,
      citizens,
      coreProtect,
      luckPerms,
      multiverseCore,
    ]) {
      const plugin = shipped.plugins.find((entry) => entry.name === pin.name);
      expect(plugin, pin.name).toMatchObject({
        version: pin.version,
        url: pin.url,
        sha256: pin.sha256,
      });
    }
  });
});
