import type { z } from "zod";
import type { MapSourceSchema } from "#protocol/ipc.ts";
import type { InfoResponse } from "#protocol/bridge.ts";

/** A generated auxiliary world cannot borrow the imported map's identity. */
export function isImportedWorld(
  source: z.infer<typeof MapSourceSchema> | undefined,
  name: string,
  server: InfoResponse | null,
): boolean {
  if (source === undefined) return false;
  // Earlier receipts imported only the primary world and did not inventory dimensions.
  if (source.dimensions === undefined) return name === "world";
  const world = server?.worlds.find((candidate) => candidate.name === name);
  return world !== undefined && source.dimensions.includes(world.key);
}
