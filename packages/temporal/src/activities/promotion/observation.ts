import { z } from "zod/v4";

const NativeObservationSchema = z.object({
  snapshot: z.object({
    nodes: z.array(
      z.object({ ref: z.string().optional(), name: z.string().optional() }),
    ),
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

export function promotionObservationQuote(text: string, ref: string): string {
  if (!text.startsWith('{"snapshot":')) {
    if (ref === "text" && text !== "") return text;
    throw new Error("Plain observations use the text evidence reference");
  }
  const node = NativeObservationSchema.parse(
    JSON.parse(text),
  ).snapshot.nodes.find((candidate) => candidate.ref === ref);
  if (node?.name === undefined || node.name === "")
    throw new Error("Evidence reference has no captured node text");
  return node.name;
}
