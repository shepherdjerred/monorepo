import { expect } from "@playwright/test";
import path from "node:path";
import { z } from "zod";

const context = z.number().int().positive();
const NexusOracleSchema = z.strictObject({
  replaySha256: z.string(),
  nexusModels: z.strictObject({
    instances: z
      .array(
        z.strictObject({
          context,
          participantId: z.number().int().nonnegative(),
          position: z.tuple([z.number(), z.number(), z.number()]),
          basis: z.array(z.number()).length(9),
        }),
      )
      .length(2),
    terminalLoss: z.strictObject({
      context,
      timeSeconds: z.number().positive(),
    }),
  }),
});

export async function verifyDirectNexusWorker(
  root: string,
  fixture: { descriptor: { sha256: string }; directNexus: boolean },
  actual: unknown,
) {
  if (!fixture.directNexus) {
    expect(actual).toBeUndefined();
    return;
  }
  const bytes = await Bun.file(
    path.join(root, "scout-8428-v43-nexus-oracle.json"),
  ).bytes();
  expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(
    "b07b8b6a6d3cf4dd055cf4a835f8062f9d6c0b9d6fa8fb0dd0bffd2579c06360",
  );
  const oracle = NexusOracleSchema.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  );
  expect(oracle.replaySha256).toBe(fixture.descriptor.sha256);
  expect(actual).toEqual({
    ...oracle.nexusModels,
    terminalLoss: {
      ...oracle.nexusModels.terminalLoss,
      payloadSha256:
        "0705adfbbda51c0f135441cb82a7aeda9b3b825c82103fb5f9127f355634bde3",
    },
  });
}
