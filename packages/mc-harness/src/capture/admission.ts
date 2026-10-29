import { createHash } from "node:crypto";
import type { RegionReadResponseSchema } from "#protocol/bridge.ts";
import type { z } from "zod";

/** Palette ordering is incidental; compare the actual state of every cell. */
export function regionFingerprint(
  region: z.infer<typeof RegionReadResponseSchema>,
): string {
  const blocks = Buffer.from(region.blocks, "base64");
  if (blocks.byteLength !== region.size.x * region.size.y * region.size.z * 4)
    throw new Error("Region block data is incomplete");
  const hash = createHash("sha256");
  for (let offset = 0; offset < blocks.length; offset += 4) {
    const state = region.palette[blocks.readUInt32LE(offset)];
    if (state === undefined) throw new Error("Region palette index is invalid");
    hash.update(state);
    hash.update("\n");
  }
  hash.update(
    JSON.stringify(
      region.blockEntities.toSorted((a, b) =>
        JSON.stringify(a).localeCompare(JSON.stringify(b)),
      ),
    ),
  );
  return hash.digest("hex");
}
