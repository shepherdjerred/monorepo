import { z } from "zod";
import { CutReasonSchema } from "#shared/editions/evidence.ts";

export const MovieEditionReasonSchema = z.enum([
  "movie_edition_choice_required",
  "movie_edition_choice_changed",
  "edition_acquisition_not_ready",
  "movie_edition_asset_unavailable",
  "movie_edition_asset_mismatch",
  "edition_definition_conflict",
  "lineage_unresolved",
  "requests_restricted",
  "plex_library_access_required",
  "plex_scope_unconfigured",
  ...CutReasonSchema.options,
]);
export const MovieEditionFulfillmentSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("not_applicable"), reason: z.null() }),
  z.strictObject({
    status: z.literal("pending_choice"),
    reason: z.literal("movie_edition_choice_required"),
  }),
  z.strictObject({
    status: z.literal("pending_edition"),
    reason: z.literal("edition_acquisition_not_ready"),
  }),
  z.strictObject({
    status: z.literal("pending_asset"),
    reason: z.literal("movie_edition_asset_unavailable"),
  }),
  z.strictObject({
    status: z.literal("protected"),
    reason: MovieEditionReasonSchema,
  }),
  z.strictObject({ status: z.literal("fulfilled"), reason: z.null() }),
]);
export type MovieEditionReason = z.infer<typeof MovieEditionReasonSchema>;
export type MovieEditionFulfillment = z.infer<
  typeof MovieEditionFulfillmentSchema
>;
