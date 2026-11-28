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
        particlePreview: z.literal("replay-decoded-billboards").optional(),
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
      const billboardAsset = paths.has("rift-billboards.json");
      const worldQuadAsset = paths.has("rift-world-quads.json");
      const ribbonFiles = [
        "rift-ribbon.json",
        "rift-projectile-pages.bin",
        "rift-projectile-worker.mjs",
      ].filter((path) => paths.has(path)).length;
      if (capabilities.rosterCoverage !== "build-scoped-archive")
        return ![
          worker,
          pages,
          billboardAsset,
          worldQuadAsset,
          ribbonFiles > 0,
        ].some(Boolean);
      const audio = capabilities.combatAudioComparison !== undefined;
      const billboards = capabilities.particlePreview !== undefined;
      return (
        !paths.has("combat-audio/cue.json") &&
        !paths.has("recorded-particles.json") &&
        !paths.has("recorded-particles.json.gz") &&
        audio === paths.has("combat-audio/329446178.wav") &&
        billboards === billboardAsset &&
        (!worldQuadAsset || billboards) &&
        (ribbonFiles === 0 || (ribbonFiles === 3 && billboards)) &&
        (audio || billboards
          ? capabilities.mapModeSource === "original-startup" && worker && pages
          : !worker && !pages)
      );
    }, "Build-scoped combat requires the original startup and creation workers, untimed media, and replay-derived clocks.");
