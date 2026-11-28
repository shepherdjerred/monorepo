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
        mapModeSource: z.literal("original-startup").optional(),
        announcerPreview: z.literal("female1-en-us").optional(),
        combatAudioComparison: z
          .literal("replay-decoded-dry-source")
          .optional(),
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
  })
    .refine(
      ({ capabilities, gameBuild, protocol }) =>
        capabilities.rosterCoverage !== "build-scoped-archive" ||
        (gameBuild === "16.23.841.8428" && protocol === "8bbfcd5af2bc92db"),
      "The build-scoped archive requires exact Map11 build and protocol.",
    )
    .refine(({ capabilities, files }) => {
      const required = new Set([
        "rift-startup-worker.mjs",
        "rift-startup-pages.bin",
      ]);
      const present = files.filter(({ path }) => required.has(path)).length;
      return capabilities.rosterCoverage === "build-scoped-archive" &&
        capabilities.mapModeSource === "original-startup"
        ? present === 2
        : present === 0;
    }, "The original startup capability and its verified worker inputs must be supplied together.")
    .refine(({ capabilities, files }) => {
      const paths = new Set(files.map(({ path }) => path));
      const worker = paths.has("rift-combat-audio-worker.mjs");
      const pages = paths.has("rift-combat-audio-pages.bin");
      if (capabilities.rosterCoverage !== "build-scoped-archive")
        return !worker && !pages;
      if (paths.has("combat-audio/cue.json")) return false;
      return capabilities.combatAudioComparison === "replay-decoded-dry-source"
        ? capabilities.mapModeSource === "original-startup" &&
            worker &&
            pages &&
            paths.has("combat-audio/329446178.wav")
        : !worker && !pages && !paths.has("combat-audio/329446178.wav");
    }, "Build-scoped combat audio requires the original startup and creation workers, authored media, and a replay-derived clock.");
