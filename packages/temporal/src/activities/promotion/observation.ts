import { z } from "zod/v4";

const NativeObservationSchema = z.object({
  snapshot: z.object({
    nodes: z.array(z.object({ name: z.string().optional() })),
  }),
});

/** Decode native node names while retaining earlier plain-text ledger entries. */
export function promotionObservationText(text: string): string {
  return text.startsWith('{"snapshot":')
    ? NativeObservationSchema.parse(JSON.parse(text))
        .snapshot.nodes.map((node) => node.name ?? "")
        .join("\n")
    : text;
}
