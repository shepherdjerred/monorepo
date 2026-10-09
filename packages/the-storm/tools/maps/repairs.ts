import { z } from "zod";

const position = z.tuple([
  z.number().int(),
  z.number().int(),
  z.number().int(),
]);
export const Repairs = z.strictObject({
  schema: z.literal(1),
  maps: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
        archiveSha256: z.string().regex(/^[a-f0-9]{64}$/u),
        reason: z.string().min(1),
        bombs: z.partialRecord(
          z.enum(["RED", "BLUE", "GREEN", "PURPLE", "YELLOW"]),
          z.array(position).min(1),
        ),
      }),
    )
    .min(1),
});

/** Repairs only explicitly missing bomb entries in the checksum-bound original, never its ZIP. */
export function repairMetadata(
  text: string,
  id: string,
  archiveSha256: string,
  raw: unknown,
) {
  const repairs = Repairs.parse(raw);
  if (new Set(repairs.maps.map((map) => map.id)).size !== repairs.maps.length)
    throw new Error("Repair file repeats a map ID");
  const repair = repairs.maps.find((map) => map.id === id);
  if (repair === undefined) return { text, repair: null };
  if (repair.archiveSha256 !== archiveSha256)
    throw new Error("Repair belongs to another original archive");
  const source = z
    .looseObject({ Custom: z.record(z.string(), z.unknown()) })
    .parse(Bun.YAML.parse(text));
  if (Object.keys(repair.bombs).length === 0)
    throw new Error("Repair has no bomb entries");
  for (const [team, positions] of Object.entries(repair.bombs)) {
    const key = `${team} Bombs`;
    if (JSON.stringify(source.Custom[key]) !== "[null]")
      throw new Error("Repair would replace existing bomb metadata");
    source.Custom[key] = positions.map((at) => at.join(","));
  }
  return { text: Bun.YAML.stringify(source), repair };
}
