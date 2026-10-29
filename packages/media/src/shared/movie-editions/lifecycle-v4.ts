import { z } from "zod";
import { MediaActionSchema, VersionSchema } from "#shared/contract.ts";
import { CommandResultSchema } from "#shared/api.ts";
import { MovieEditionScopeSchema, MovieEditionHashSchema } from "./registry.ts";
import {
  MovieRequestV3Schema,
  MovieRequestResultV3Schema,
  CancelMovieRequestV3Schema,
  CancelMovieRequestResultV3Schema,
  RevokeMovieEditionChoiceV3Schema,
  RevokeMovieEditionChoiceResultV3Schema,
} from "./commands.ts";

/** A distinct protocol identity: old command bodies, hashes and committed ACKs never change. */
export const MovieRequestV4Schema = MovieRequestV3Schema.extend({
  schemaVersion: z.literal(4),
});
export const MovieRequestResultV4Schema = MovieRequestResultV3Schema.extend({
  schemaVersion: z.literal(4),
});
export const CancelMovieRequestV4Schema = CancelMovieRequestV3Schema.extend({
  schemaVersion: z.literal(4),
});
export const CancelMovieRequestResultV4Schema =
  CancelMovieRequestResultV3Schema.extend({ schemaVersion: z.literal(4) });
export const RevokeMovieEditionChoiceV4Schema =
  RevokeMovieEditionChoiceV3Schema.extend({ schemaVersion: z.literal(4) });
export const RevokeMovieEditionChoiceResultV4Schema =
  RevokeMovieEditionChoiceResultV3Schema.extend({
    schemaVersion: z.literal(4),
  });

export const MovieRemovalConfirmationV4Schema = z.strictObject({
  scope: MovieEditionScopeSchema,
  fileSetHash: MovieEditionHashSchema,
  assets: z
    .array(
      z.strictObject({
        assetId: z.uuid(),
        assetVersion: VersionSchema,
        checksum: MovieEditionHashSchema,
      }),
    )
    .min(1)
    .max(100),
});
export const MovieLifecycleActionV4Schema = z.discriminatedUnion("action", [
  MediaActionSchema.options[0].omit({ expectedVersion: true }),
  MediaActionSchema.options[1].omit({ expectedVersion: true }),
  MediaActionSchema.options[2].omit({ expectedVersion: true }),
  MediaActionSchema.options[3].omit({ expectedVersion: true }),
  z.strictObject({
    action: z.literal("remove"),
    confirmation: MovieRemovalConfirmationV4Schema,
  }),
  MediaActionSchema.options[5].omit({ expectedVersion: true }),
  MediaActionSchema.options[6].omit({ expectedVersion: true }),
]);
export const MovieTargetExpectedV4Schema = z.strictObject({
  mediaVersion: VersionSchema,
  targetVersion: VersionSchema,
});
export const MovieLifecycleCommandV4Schema = z
  .strictObject({
    schemaVersion: z.literal(4),
    scope: MovieEditionScopeSchema,
    expected: MovieTargetExpectedV4Schema,
    command: MovieLifecycleActionV4Schema,
  })
  .refine(
    (value) =>
      value.command.action !== "remove" ||
      (value.command.confirmation.scope.rootMediaId ===
        value.scope.rootMediaId &&
        value.command.confirmation.scope.mediaId === value.scope.mediaId &&
        value.command.confirmation.scope.edition === value.scope.edition),
    "Removal confirmation must cover this exact movie edition",
  );
export const MovieLifecycleResultV4Schema = z.strictObject({
  schemaVersion: z.literal(4),
  scope: MovieEditionScopeSchema,
  result: CommandResultSchema.strict(),
  applied: MovieTargetExpectedV4Schema,
});
export type MovieRequestV4 = z.infer<typeof MovieRequestV4Schema>;
export type MovieLifecycleCommandV4 = z.infer<
  typeof MovieLifecycleCommandV4Schema
>;
export type MovieLifecycleResultV4 = z.infer<
  typeof MovieLifecycleResultV4Schema
>;
