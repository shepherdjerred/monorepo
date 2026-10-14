import path from "node:path";
import { z } from "zod";
import {
  readSchematic,
  writeSchematic,
} from "@shepherdjerred/mc-build/core/schem.ts";
import type { BlockGrid } from "@shepherdjerred/mc-build/core/grid.ts";
import { terrainHash } from "#maps/author.ts";

const point = z.strictObject({
  x: z.number().int(),
  y: z.number().int(),
  z: z.number().int(),
});
const face = z.strictObject({
  lines: z.array(z.string()).length(4),
  color: z.string(),
  glowing: z.boolean(),
});
export const Details = z.strictObject({
  version: z.literal(1),
  blocksSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  containers: z.array(z.unknown()),
  signs: z.array(
    z.strictObject({
      at: point,
      material: z.string(),
      front: face,
      back: face,
      waxed: z.boolean(),
    }),
  ),
});

/** Match the upstream import policy on either modern sign face. */
export function isShopSign(
  sign: z.infer<typeof Details>["signs"][number],
): boolean {
  return [sign.front, sign.back].some((side) =>
    side.lines.some((line) =>
      line
        .replaceAll(/§[0-9a-fk-orx]/giu, "")
        .toLowerCase()
        .includes("[buy]"),
    ),
  );
}

export function stripShopSigns(
  grid: BlockGrid,
  details: z.infer<typeof Details>,
) {
  const removed = details.signs
    .filter((sign) => isShopSign(sign))
    .map((sign) => {
      const { x, y, z: south } = sign.at;
      if (!grid.inBounds(x, y, south))
        throw new Error("Shop sign is outside terrain");
      const state = grid.get(x, y, south);
      if (!state.startsWith(`${sign.material}[`) && state !== sign.material)
        throw new Error("Shop sign payload differs from terrain");
      grid.set(x, y, south, "minecraft:air");
      return { sign, state };
    });
  return {
    removed,
    details: {
      ...details,
      signs: details.signs.filter((sign) => !isShopSign(sign)),
    },
  };
}

/** Strip after native payload export; raw source archives remain untouched. */
export async function removeShops(folder: string): Promise<number> {
  const details = Details.parse(
    await Bun.file(path.join(folder, "details.json")).json(),
  );
  const schematic = await readSchematic(
    new Uint8Array(
      await Bun.file(path.join(folder, "blocks.schem")).arrayBuffer(),
    ),
  );
  if (terrainHash(schematic.grid) !== details.blocksSha256)
    throw new Error("Shop removal received stale terrain payloads");
  const result = stripShopSigns(schematic.grid, details);
  if (result.removed.length === 0) return 0;
  const encoded = writeSchematic(
    schematic.grid,
    schematic.dataVersion,
    schematic.offset,
  );
  const decoded = await readSchematic(encoded);
  const hash = terrainHash(decoded.grid);
  const metadata = z
    .record(z.string(), z.unknown())
    .parse(Bun.YAML.parse(await Bun.file(path.join(folder, "map.yml")).text()));
  const source = z
    .record(z.string(), z.unknown())
    .parse(await Bun.file(path.join(folder, "source.json")).json());
  const updatedDetails = { ...result.details, blocksSha256: hash };
  await Bun.write(
    path.join(folder, "removed-shops.json"),
    JSON.stringify(
      {
        schema: 1,
        policy: "remove-legacy-buy-signs-both-faces",
        originalBlocksSha256: details.blocksSha256,
        blocksSha256: hash,
        removed: result.removed,
      },
      null,
      2,
    ) + "\n",
  );
  await Bun.write(path.join(folder, "blocks.schem"), encoded);
  await Bun.write(
    path.join(folder, "map.yml"),
    Bun.YAML.stringify({ ...metadata, blocksSha256: hash }),
  );
  const detailsText = JSON.stringify(updatedDetails, null, 2) + "\n";
  await Bun.write(path.join(folder, "details.json"), detailsText);
  await Bun.write(
    path.join(folder, "source.json"),
    JSON.stringify(
      {
        ...source,
        shopRemoval: {
          policy: "remove-legacy-buy-signs-both-faces",
          originalBlocksSha256: details.blocksSha256,
          blocksSha256: hash,
          count: result.removed.length,
          receipt: "removed-shops.json",
        },
      },
      null,
      2,
    ) + "\n",
  );
  const provenancePath = path.join(folder, "details.provenance.json");
  if (await Bun.file(provenancePath).exists()) {
    const provenance = z
      .record(z.string(), z.unknown())
      .parse(await Bun.file(provenancePath).json());
    await Bun.write(
      provenancePath,
      JSON.stringify(
        {
          ...provenance,
          blocksSha256: hash,
          detailsSha256: new Bun.CryptoHasher("sha256")
            .update(detailsText)
            .digest("hex"),
          policy:
            "preserve-inventories-and-other-signs-remove-legacy-buy-signs",
          shopRemoval: {
            originalBlocksSha256: details.blocksSha256,
            count: result.removed.length,
          },
        },
        null,
        2,
      ) + "\n",
    );
  }
  await bindDetailsProvenance(folder);
  return result.removed.length;
}

/** Retain the native extraction receipt and describe the final installed payload separately. */
export async function bindDetailsProvenance(folder: string): Promise<void> {
  const file = path.join(folder, "details.provenance.json");
  if (!(await Bun.file(file).exists())) return;
  const provenance = z
    .record(z.string(), z.unknown())
    .parse(await Bun.file(file).json());
  if (provenance["shopRemoval"] === undefined) return;
  const details = Details.parse(
    await Bun.file(path.join(folder, "details.json")).json(),
  );
  const result = z
    .object({
      state: z.literal("complete"),
      containers: z.number().int(),
      signs: z.number().int(),
    })
    .parse(provenance["result"]);
  await Bun.write(
    file,
    JSON.stringify(
      {
        ...provenance,
        nativeExportResult: provenance["nativeExportResult"] ?? result,
        result: {
          ...result,
          containers: details.containers.length,
          signs: details.signs.length,
        },
      },
      null,
      2,
    ) + "\n",
  );
}
