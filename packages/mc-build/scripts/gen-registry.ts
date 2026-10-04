/**
 * Regenerates src/registry/generated/blocks-26.2.json from a live MCBridge
 * `/v1/registry` response. Capture one from a sandbox first:
 *
 *   toolkit mc registry --out /tmp/registry.json
 *   bun run scripts/gen-registry.ts /tmp/registry.json
 *
 * Re-run on every Paper bump; test/registry.test.ts pins the version.
 */
import { z } from "zod";
import { parseBlockState } from "#src/core/block-state.ts";
import {
  REGISTRY_PATH,
  RegistryFileSchema,
  type RegistryFile,
} from "#src/registry/registry.ts";

// Mirrors RegistryResponseSchema in @shepherdjerred/mc-harness/protocol/bridge.ts;
// duplicated so this pure package stays independent of the harness.
const BridgeRegistrySchema = z.strictObject({
  dataVersion: z.number().int(),
  minecraftVersion: z.string(),
  blocks: z.array(
    z.strictObject({
      id: z.string(),
      defaultState: z.string(),
      properties: z.record(z.string(), z.array(z.string())),
    }),
  ),
});

const input = Bun.argv[2];
if (input === undefined) {
  console.error("usage: bun run scripts/gen-registry.ts <registry.json>");
  process.exit(1);
}

const response = BridgeRegistrySchema.parse(await Bun.file(input).json());
const blocks: RegistryFile["blocks"] = {};
for (const block of response.blocks.toSorted((a, b) =>
  a.id.localeCompare(b.id),
)) {
  const defaults = parseBlockState(block.defaultState).properties;
  const properties: Record<string, string[]> = {};
  for (const key of Object.keys(block.properties).toSorted()) {
    properties[key] = block.properties[key] ?? [];
  }
  blocks[block.id] = { properties, defaults: { ...defaults } };
}
const file = RegistryFileSchema.parse({
  minecraftVersion: response.minecraftVersion,
  dataVersion: response.dataVersion,
  blocks,
});
await Bun.write(REGISTRY_PATH, `${JSON.stringify(file)}\n`);
process.stdout.write(
  `wrote ${REGISTRY_PATH}: ${Object.keys(blocks).length.toString()} blocks, Minecraft ${file.minecraftVersion}, data ${file.dataVersion.toString()}\n`,
);
