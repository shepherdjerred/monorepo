import { ReplayRenderPackageInventorySchema } from "@scout-for-lol/domain/artifacts/replay-support.ts";
import { z } from "zod";

const recordedReplayCapabilities = {
  teamSizes: z.tuple([z.literal(5), z.literal(5)]),
  rosterCoverage: z.literal("recorded-replay"),
  replaySha256: z.string().regex(/^[0-9a-f]{64}$/),
  announcerPreview: z.literal("female1-en-us").optional(),
  particlePreview: z.literal("verified-partial-effects").optional(),
};

export const LocalScoutTerrainManifestSchema =
  ReplayRenderPackageInventorySchema.safeExtend({
    capabilities: z.discriminatedUnion("mapId", [
      z.strictObject({
        mapId: z.literal(11),
        gameMode: z.literal("CLASSIC"),
        ...recordedReplayCapabilities,
      }),
      z.strictObject({
        mapId: z.literal(12),
        gameMode: z.literal("KIWI"),
        mayhemMapSkin: z.string().min(1),
        ...recordedReplayCapabilities,
      }),
    ]),
  });
