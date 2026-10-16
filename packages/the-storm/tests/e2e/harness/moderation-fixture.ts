import { z } from "zod";

const contract = z
  .object({ version: z.literal(1), requestFields: z.array(z.string()) })
  .parse(
    JSON.parse(
      await Bun.file(
        new URL(
          "../../../../storm-brain/contracts/content-moderation.json",
          import.meta.url,
        ),
      ).text(),
    ),
  );

export function moderate(body: unknown): Response {
  const seen = z.record(z.string(), z.unknown()).safeParse(body);
  if (
    !seen.success ||
    Object.keys(seen.data).sort().join(",") !==
      [...contract.requestFields].sort().join(",")
  )
    return new Response("invalid content request", { status: 400 });
  const input = z.object({ text: z.string() }).parse(body);
  const blocked = input.text.includes("[fixture-threat]");
  const advert = input.text.includes("[fixture-cold-ad]");
  return Response.json({
    version: 1,
    decision: blocked || advert ? "block" : "allow",
    category: blocked ? "threat" : advert ? "advertising" : "none",
    confidence: 0.99,
    reason: "Explicit moderation fixture.",
    model: "moderation-fixture",
    costMicros: 0,
    scores: {},
  });
}
