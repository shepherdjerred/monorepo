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
    capabilities: z.union([
      z.strictObject({
        mapId: z.literal(11),
        gameMode: z.literal("CLASSIC"),
        teamSizes: z.tuple([z.literal(5), z.literal(5)]),
        rosterCoverage: z.literal("build-scoped-archive"),
      }),
      z.discriminatedUnion("mapId", [
        z.strictObject({
          mapId: z.literal(11),
          gameMode: z.literal("CLASSIC"),
          combatAudioComparison: z
            .literal("packet-clock-dry-source")
            .optional(),
          ...recordedReplayCapabilities,
        }),
        z
          .strictObject({
            mapId: z.literal(12),
            gameMode: z.literal("KIWI"),
            mayhemMapSkin: z.string().min(1),
            mayhemImpactComparison: z
              .literal("supplied-random-world-quad")
              .optional(),
            ...recordedReplayCapabilities,
          })
          .refine(
            ({ mayhemImpactComparison, mayhemMapSkin, particlePreview }) =>
              mayhemImpactComparison === undefined ||
              (mayhemMapSkin === "Bloom" && particlePreview === undefined),
            "The supplied-random impact comparison requires a private Bloom package.",
          ),
      ]),
    ]),
  }).refine(
    ({ capabilities, gameBuild, protocol }) =>
      capabilities.rosterCoverage !== "build-scoped-archive" ||
      (gameBuild === "16.23.841.8428" && protocol === "8bbfcd5af2bc92db"),
    "The build-scoped archive requires exact Map11 build and protocol.",
  );
