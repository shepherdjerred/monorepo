import { ReplayRenderPackageInventorySchema } from "@scout-for-lol/domain/artifacts/replay-support.ts";
import { z } from "zod";

export const LocalScoutTerrainManifestSchema =
  ReplayRenderPackageInventorySchema.safeExtend({
    capabilities: z.strictObject({
      mapId: z.literal(11),
      gameMode: z.literal("CLASSIC"),
      teamSizes: z.tuple([z.literal(5), z.literal(5)]),
      rosterCoverage: z.literal("recorded-replay"),
      replaySha256: z.string().regex(/^[0-9a-f]{64}$/),
      announcerPreview: z.literal("female1-en-us").optional(),
      particlePreview: z.literal("verified-partial-effects").optional(),
    }),
  });
