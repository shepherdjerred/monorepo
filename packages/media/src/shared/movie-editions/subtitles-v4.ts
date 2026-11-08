import { z } from "zod";
import { MovieEditionScopeSchema, MovieEditionHashSchema } from "./registry.ts";

export const MovieSubtitleTargetV4Schema = z.strictObject({
  language: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$/u),
  forced: z.boolean().optional(),
  hearingImpaired: z.enum(["required", "excluded", "any"]).optional(),
});
export const MovieSubtitleOperationV4Schema =
  MovieSubtitleTargetV4Schema.extend({
    schemaVersion: z.literal(4),
    operationId: z.uuid(),
    scope: MovieEditionScopeSchema,
    assetId: z.uuid(),
    recoveryEpoch: z.int().nonnegative(),
    targetAuthority: MovieEditionHashSchema,
  });
export const MovieSubtitleInstallV4Schema = z.strictObject({
  schemaVersion: z.literal(4),
  operationId: z.uuid(),
  scope: MovieEditionScopeSchema,
  assetId: z.uuid(),
  subtitleId: z.uuid(),
});
export type MovieSubtitleOperationV4 = z.infer<
  typeof MovieSubtitleOperationV4Schema
>;
export type MovieSubtitleInstallV4 = z.infer<
  typeof MovieSubtitleInstallV4Schema
>;

export function movieSubtitleTargetV4(
  input: z.infer<typeof MovieSubtitleTargetV4Schema>,
) {
  return {
    language: input.language,
    ...(input.forced === undefined ? {} : { forced: input.forced }),
    ...(input.hearingImpaired === undefined
      ? {}
      : { hearingImpaired: input.hearingImpaired }),
  };
}
