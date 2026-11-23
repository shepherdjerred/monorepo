import { z } from "zod";
import { normalizeGameBuild } from "./replay-transport.mjs";

const BuildSchema = z.string().regex(/^\d+\.\d+\.\d+\.\d+$/);
const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const RelativePathSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      /^[\w./-]+$/.test(value) &&
      value
        .split("/")
        .every((part) => part !== "" && part !== "." && part !== ".."),
    "Expected a closed relative package path",
  );
const ImmutablePathSchema = z.string().refine(
  (value) =>
    value.startsWith("/") &&
    !value.startsWith("//") &&
    /^[\w./-]+$/.test(value) &&
    value
      .split("/")
      .slice(1)
      .every((part) => part !== "" && part !== "." && part !== ".."),
  "Expected a same-origin immutable path",
);

/** Official native-build observation, separately refreshed for each platform. */
export const ReplayPatchObservationSchema = z
  .strictObject({
    platformId: z.string().regex(/^[A-Z]{2,4}\d{0,2}$/),
    patch: z.string().regex(/^\d+\.\d+$/),
    gameBuild: BuildSchema,
    sourceUrl: z.url().refine((value) => new URL(value).protocol === "https:"),
    sourceSha256: DigestSchema,
    observedAt: z.iso.datetime(),
  })
  .superRefine((observation, ctx) => {
    const nativeBuild = normalizeGameBuild(observation.gameBuild);
    const source = `https://sieve.services.riotcdn.net/api/v1/products/lol/version-sets/${observation.platformId}/versions?platform=windows`;
    if (
      nativeBuild === null ||
      nativeBuild !== observation.gameBuild ||
      nativeBuild.split(".").slice(0, 2).join(".") !== observation.patch ||
      observation.sourceUrl !== source
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Observation must name its canonical native build and official platform release source",
      });
  });

export const ReplayRenderPackageInventorySchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    gameBuild: BuildSchema,
    protocol: z.string().regex(/^[0-9a-f]{16}$/),
    entrypoint: RelativePathSchema,
    files: z
      .array(
        z.strictObject({
          path: RelativePathSchema.refine(
            (path) => path !== "manifest.json",
            "The root manifest.json is reserved for the package manifest",
          ),
          sha256: DigestSchema,
          bytes: z
            .number()
            .int()
            .positive()
            .max(512 * 1024 * 1024),
        }),
      )
      .min(1),
  })
  .superRefine((manifest, ctx) => {
    const paths = manifest.files.map((file) => file.path);
    if (
      new Set(paths).size !== paths.length ||
      !paths.includes(manifest.entrypoint)
    )
      ctx.addIssue({
        code: "custom",
        message: "Package inventory must be unique and contain its entrypoint",
      });
  });

export const ReplayRenderPackageManifestSchema =
  ReplayRenderPackageInventorySchema.safeExtend({
    capabilities: z.strictObject({
      mapId: z.literal(11),
      gameMode: z.literal("CLASSIC"),
      teamSizes: z.tuple([z.literal(5), z.literal(5)]),
      rosterCoverage: z.literal("all-legal-lineups-and-skins"),
      rosterInventorySha256: DigestSchema,
    }),
  });

/** Publication alone never admits a renderer; native comparison evidence is bound to it. */
export const ReplayRenderPackageAdmissionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  manifestSha256: DigestSchema,
  rosterInventorySha256: DigestSchema,
  nativeComparison: z.strictObject({
    gameBuild: BuildSchema,
    reportPath: ImmutablePathSchema,
    reportSha256: DigestSchema,
    referenceCaptureSha256: DigestSchema,
    result: z.literal("perceptual-equivalence"),
    coverage: z.literal("whole-match-visual-audio-and-spectator-controls"),
  }),
});

export type ReplayPatchObservation = z.infer<
  typeof ReplayPatchObservationSchema
>;
export type ReplayRenderPackageManifest = z.infer<
  typeof ReplayRenderPackageManifestSchema
>;
export type ReplayRenderPackageAdmission = z.infer<
  typeof ReplayRenderPackageAdmissionSchema
>;
