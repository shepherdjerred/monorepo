import { z } from "zod";
import { VersionSchema } from "#shared/contract.ts";
import {
  MovieEditionDefinitionRefSchema,
  MovieEditionHashSchema,
  MovieEditionKeySchema,
  MovieEditionPolicySchema,
  MovieEditionScopeSchema,
} from "./registry.ts";
import {
  MovieEditionFulfillmentSchema,
  MovieEditionReasonSchema,
} from "./fulfillment.ts";

export const MovieEditionContextQuerySchema = z.strictObject({
  subjectUserId: z.uuid().optional(),
});
export const MovieEditionRequestListQuerySchema = z.strictObject({
  subjectUserId: z.uuid().optional(),
  cursor: z.uuid().optional(),
});
export const MovieEditionContextV3Schema = z.strictObject({
  schemaVersion: z.literal(3),
  mediaId: z.uuid(),
  subjectUserId: z.uuid(),
  access: z.literal("detail"),
  mediaVersion: VersionSchema,
  registryVersion: z.literal(1),
  options: z
    .array(
      z.strictObject({
        edition: MovieEditionKeySchema,
        definitionVersion: z.literal(0),
        definitionDigest: MovieEditionHashSchema,
        displayLabel: z.string().min(1),
        policy: MovieEditionPolicySchema,
        storedDefinition: MovieEditionDefinitionRefSchema.nullable(),
        targetVersion: VersionSchema.nullable(),
        request: z
          .strictObject({
            id: z.uuid(),
            version: VersionSchema,
            choiceRevision: VersionSchema,
            choiceId: z.uuid().nullable(),
          })
          .nullable(),
        acquisition: z.enum(["eligible", "protected"]),
        reasons: z.array(MovieEditionReasonSchema),
      }),
    )
    .length(7)
    .refine(
      (options) => new Set(options.map((option) => option.edition)).size === 7,
      "Edition options must be unique",
    ),
  pendingDemands: z
    .array(
      z.strictObject({
        requestId: z.uuid(),
        reason: z.literal("movie_edition_choice_required"),
        choiceId: z.null(),
        fulfillment: z.literal("pending_choice"),
      }),
    )
    .max(100),
});
const RequestFields = {
  requestId: z.uuid(),
  scope: MovieEditionScopeSchema,
  active: z.boolean(),
  targetVersion: VersionSchema,
  requestVersion: VersionSchema,
  choiceRevision: VersionSchema,
  choiceId: z.uuid().nullable(),
  fulfillment: MovieEditionFulfillmentSchema,
  canCancel: z.boolean(),
  canRevokeChoice: z.boolean(),
};
export const MovieEditionRequestViewSchema = z.discriminatedUnion("access", [
  z.strictObject({
    ...RequestFields,
    access: z.literal("detail"),
    title: z.string().min(1),
    year: z.int().nullable(),
    editionLabel: z.string().min(1),
  }),
  z.strictObject({ ...RequestFields, access: z.literal("protection_only") }),
]);
export const MovieEditionRequestListV3Schema = z.strictObject({
  schemaVersion: z.literal(3),
  subjectUserId: z.uuid(),
  items: z.array(MovieEditionRequestViewSchema).max(50),
  nextCursor: z.uuid().nullable(),
});
export type MovieEditionContextV3 = z.infer<typeof MovieEditionContextV3Schema>;
export type MovieEditionRequestView = z.infer<
  typeof MovieEditionRequestViewSchema
>;
export type MovieEditionRequestListV3 = z.infer<
  typeof MovieEditionRequestListV3Schema
>;
export type MovieEditionContextQuery = z.infer<
  typeof MovieEditionContextQuerySchema
>;
export type MovieEditionRequestListQuery = z.infer<
  typeof MovieEditionRequestListQuerySchema
>;
