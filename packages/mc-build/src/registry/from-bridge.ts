import { normalizeBlockState, parseBlockState } from "#src/core/block-state.ts";
import type { BlockLighting } from "./lighting.ts";
import {
  RegistryFileSchema,
  BlockRegistry,
  type RegistryFile,
} from "#src/registry/registry.ts";

/** The parts of an MCBridge `/v1/registry` response the registry file needs. */
export type BridgeRegistry = {
  readonly minecraftVersion: string;
  readonly dataVersion: number;
  readonly blocks: readonly {
    readonly id: string;
    readonly defaultState: string;
    readonly properties: Readonly<Record<string, readonly string[]>>;
    readonly lighting: BlockLighting;
  }[];
};

/** Converts a validated bridge registry into the committed, sorted registry file. */
export function registryFileFromBridge(response: BridgeRegistry): RegistryFile {
  const blocks: RegistryFile["blocks"] = {};
  for (const block of response.blocks.toSorted((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    const defaults = parseBlockState(block.defaultState).properties;
    const properties: Record<string, string[]> = {};
    for (const key of Object.keys(block.properties).toSorted()) {
      properties[key] = [...(block.properties[key] ?? [])];
    }
    const count = Object.values(properties).reduce(
      (total, values) => total * values.length,
      1,
    );
    if (block.lighting.states !== count)
      throw new Error(
        `${block.id} lighting covers ${block.lighting.states.toString()} states, expected ${count.toString()}`,
      );
    const overrides = Object.fromEntries(
      Object.entries(block.lighting.overrides).map(([state, lighting]) => [
        normalizeBlockState(state),
        lighting,
      ]),
    );
    blocks[block.id] = {
      properties,
      defaults: { ...defaults },
      lighting: { ...block.lighting, overrides },
    };
  }
  const file = RegistryFileSchema.parse({
    minecraftVersion: response.minecraftVersion,
    dataVersion: response.dataVersion,
    blocks,
  });
  const registry = new BlockRegistry(file);
  for (const [id, block] of Object.entries(file.blocks)) {
    for (const state of Object.keys(block.lighting.overrides)) {
      if (parseBlockState(state).id !== id || registry.resolve(state) !== state)
        throw new Error(
          `${id} lighting override is not a complete canonical state: ${state}`,
        );
    }
  }
  return file;
}
