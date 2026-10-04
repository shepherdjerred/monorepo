import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { paper, worldEdit } from "#src/pins.ts";

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
    const we = shipped.plugins.find((plugin) => plugin.name === "WorldEdit");
    expect(we).toMatchObject({
      version: worldEdit.version,
      url: worldEdit.url,
      sha256: worldEdit.sha256,
    });
  });
});
