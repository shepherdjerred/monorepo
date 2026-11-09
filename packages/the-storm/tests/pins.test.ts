import path from "node:path";
import { paper, serverImage } from "@shepherdjerred/mc-harness/pins.ts";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { thirdPartyPlugins } from "./e2e/harness/pins.ts";

// server/plugins.json is the production pin. Every copy outside it must match,
// so a bump that misses one fails here instead of testing a different build.
const PluginsJsonSchema = z.object({
  paper: z.object({ version: z.string() }),
  plugins: z.array(
    z.object({
      name: z.string(),
      version: z.string(),
      url: z.string(),
      sha256: z.string(),
    }),
  ),
});

const packageRoot = path.resolve(import.meta.dirname, "..");
const stormLane = path.resolve(
  packageRoot,
  "../woodpecker-config-extension/src/pipeline/lanes/storm-e2e.ts",
);

async function shipped() {
  return PluginsJsonSchema.parse(
    await Bun.file(path.join(packageRoot, "server/plugins.json")).json(),
  );
}

describe("pins", () => {
  it("e2e plugins match the production image", async () => {
    const { plugins } = await shipped();
    for (const pin of thirdPartyPlugins) {
      const plugin = plugins.find((entry) => entry.name === pin.name);
      expect(plugin, pin.name).toMatchObject({
        version: pin.version,
        url: pin.url,
        sha256: pin.sha256,
      });
    }
  });

  it("the CI smoke lane starts the pinned Paper image and build", async () => {
    const lane = await Bun.file(stormLane).text();
    const manifest = await shipped();
    const pin = /^(?<version>[\d.]+)-(?<build>\d+)$/u.exec(
      manifest.paper.version,
    )?.groups;
    if (pin?.["version"] === undefined || pin["build"] === undefined)
      throw new Error(`Malformed Paper pin ${manifest.paper.version}`);
    expect(pin["version"]).toBe(paper.version);
    expect(lane).toContain(`VERSION: "${pin["version"]}"`);
    expect(lane).toContain(`PAPER_BUILD: "${pin["build"]}"`);
    expect(lane).toContain(`"${serverImage}"`);
  });
});
