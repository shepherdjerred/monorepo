import { z } from "zod";
import { FileIdentityEvidenceSchema } from "./identity.ts";
import { EpisodeCoordinateEvidenceSchema } from "./coordinates.ts";

export const TvSeasonDirectorySchema = z.strictObject({
  index: z.int().nonnegative().max(30),
  segment: z.string().regex(/^(?:season[ ._-]*|s)\d{1,3}$/iu),
  season: z.int().positive().max(999),
  member: z.string().regex(/^e?\d{1,4}\.(?:mkv|mp4|m4v|avi|ts)$/iu),
  episode: z.int().positive().max(9999),
});

/** A new TV member interpretation; the v1 object and movie extensions remain literal. */
export const TvFileIdentityEvidenceV2Schema = FileIdentityEvidenceSchema.omit({
  schemaVersion: true,
  parsedCoordinates: true,
})
  .extend({
    schemaVersion: z.literal(2),
    kind: z.literal("tv_season_directory"),
    numberingDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    parsedCoordinates: EpisodeCoordinateEvidenceSchema,
    directory: TvSeasonDirectorySchema,
    coverage: z.tuple([z.uuid()]),
  })
  .refine((evidence) => {
    const components = evidence.sourceFile.relativePath.split("/");
    const directory = evidence.directory;
    const form = evidence.parsedCoordinates.forms[0];
    const season = /\d+$/u.exec(directory.segment)?.[0];
    const episode = /^e?(\d+)/iu.exec(directory.member)?.[1];
    return (
      components.length <= 32 &&
      components
        .slice(0, -1)
        .filter(
          (segment) =>
            TvSeasonDirectorySchema.shape.segment.safeParse(segment).success,
        ).length === 1 &&
      components.every(
        (part) =>
          part !== "" && part !== "." && part !== ".." && !part.includes("\\"),
      ) &&
      directory.index === components.length - 2 &&
      components[directory.index] === directory.segment &&
      components.at(-1) === directory.member &&
      Number(season) === directory.season &&
      Number(episode) === directory.episode &&
      !evidence.parsedCoordinates.invalid &&
      evidence.parsedCoordinates.forms.length === 1 &&
      form?.kind === "season_episodes" &&
      form.form === "single" &&
      form.season === directory.season &&
      form.episodes.length === 1 &&
      form.episodes[0] === directory.episode
    );
  }, "TV directory evidence must retain its exact member path and one explicit canonical coordinate");

export const DefaultFileIdentityEvidenceSchema = z.discriminatedUnion(
  "schemaVersion",
  [FileIdentityEvidenceSchema, TvFileIdentityEvidenceV2Schema],
);
export type TvSeasonDirectory = z.infer<typeof TvSeasonDirectorySchema>;
export type DefaultFileIdentityEvidence = z.infer<
  typeof DefaultFileIdentityEvidenceSchema
>;
