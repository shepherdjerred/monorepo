import { parseBlockState } from "#src/core/block-state.ts";
import {
  RegistryFileSchema,
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
    blocks[block.id] = { properties, defaults: { ...defaults } };
  }
  return RegistryFileSchema.parse({
    minecraftVersion: response.minecraftVersion,
    dataVersion: response.dataVersion,
    blocks,
  });
}
