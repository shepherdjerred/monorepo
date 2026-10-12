/**
 * Regenerates mc-build's committed block registry from a live MCBridge
 * `/v1/registry` response. Capture one from a sandbox first:
 *
 *   toolkit mc registry --out /tmp/registry.json
 *   bun run --cwd packages/mc-harness gen-registry /tmp/registry.json
 *
 * Re-run on every Paper bump; mc-build's test/registry.test.ts pins the version.
 */
import { registryFileFromBridge } from "@shepherdjerred/mc-build/registry/from-bridge.ts";
import { REGISTRY_PATH } from "@shepherdjerred/mc-build/registry/registry.ts";
import { RegistryResponseSchema } from "#protocol/bridge.ts";

const input = Bun.argv[2];
if (input === undefined) {
  console.error("usage: bun run scripts/gen-registry.ts <registry.json>");
  process.exit(1);
}

const file = registryFileFromBridge(
  RegistryResponseSchema.parse(await Bun.file(input).json()),
);
await Bun.write(REGISTRY_PATH, `${JSON.stringify(file)}\n`);
process.stdout.write(
  `wrote ${REGISTRY_PATH}: ${Object.keys(file.blocks).length.toString()} blocks, Minecraft ${file.minecraftVersion}, data ${file.dataVersion.toString()}\n`,
);
