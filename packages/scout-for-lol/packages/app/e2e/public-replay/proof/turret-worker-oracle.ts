import { expect } from "@playwright/test";
import path from "node:path";
import { z } from "zod";

const context = z.number().int().positive();
const position = z.tuple([z.number(), z.number(), z.number()]);
const TurretOracleSchema = z.strictObject({
  replaySha256: z.string(),
  structureModels: z.strictObject({
    instances: z
      .array(
        z.strictObject({
          context,
          participantId: z.number().int().nonnegative(),
          position,
          basis: z.array(z.number()).length(9),
          destroyedAtSeconds: z.number().positive().nullable(),
        }),
      )
      .length(21),
    omittedContexts: z.array(context).length(1),
  }),
  turretLosses: z
    .array(
      z.strictObject({
        kind: z.literal("turret-destruction"),
        context,
        timeSeconds: z.number().positive(),
        secondTimeBits: z.number().int().nonnegative(),
        defendingPartition: z.union([z.literal(0), z.literal(1)]),
        mapNameHash: z.number().int().nonnegative(),
        worldPosition: position,
      }),
    )
    .length(17),
});

export async function verifyDirectTurretWorker(
  root: string,
  fixture: { descriptor: { sha256: string }; directTurrets: boolean },
  actual: { structureModels?: unknown; turretLosses?: unknown },
) {
  if (!fixture.directTurrets) {
    expect(actual.structureModels).toBeUndefined();
    expect(actual.turretLosses).toBeUndefined();
    return;
  }
  const bytes = await Bun.file(
    path.join(root, "scout-8428-v42-turret-oracle.json"),
  ).bytes();
  expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(
    "5cd8e8b91f4591dbc4a80c52826e9cbf44714755b43db75d8fd80b4372e4a783",
  );
  const oracle = TurretOracleSchema.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  );
  expect(oracle.replaySha256).toBe(fixture.descriptor.sha256);
  expect(actual.structureModels).toEqual(oracle.structureModels);
  expect(actual.turretLosses).toEqual(oracle.turretLosses);
}
