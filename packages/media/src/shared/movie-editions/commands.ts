import { z } from "zod";
import { LanguageSchema, VersionSchema } from "#shared/contract.ts";
import {
  MovieEditionDefinitionRefSchema,
  MovieEditionHashSchema,
  MovieEditionKeySchema,
  MovieEditionScopeSchema,
} from "./registry.ts";
import { MovieEditionReasonSchema } from "./fulfillment.ts";

const RequestExpected = z.strictObject({
  id: z.uuid(),
  version: VersionSchema,
  choiceRevision: VersionSchema,
});
export const MovieRequestV3Schema = z.strictObject({
  schemaVersion: z.literal(3),
  mediaId: z.uuid(),
  subjectUserId: z.uuid(),
  expected: z.strictObject({
    mediaVersion: VersionSchema,
    targetVersion: VersionSchema.nullable(),
    definition: MovieEditionDefinitionRefSchema.nullable(),
    request: RequestExpected.nullable(),
  }),
  selection: z.strictObject({
    edition: MovieEditionKeySchema,
    definitionVersion: z.literal(0),
    definitionDigest: MovieEditionHashSchema,
    registryVersion: z.literal(1),
  }),
  options: z.strictObject({
    subtitleLanguages: z.array(LanguageSchema).max(20),
  }),
});
const Applied = z.strictObject({
  targetVersion: VersionSchema,
  requestVersion: VersionSchema,
  choiceRevision: VersionSchema,
});
export const MovieRequestResultV3Schema = z.strictObject({
  schemaVersion: z.literal(3),
  mediaId: z.uuid(),
  subjectUserId: z.uuid(),
  edition: MovieEditionKeySchema,
  requestId: z.uuid(),
  choiceId: z.uuid(),
  state: z.enum(["queued", "pending"]),
  reason: MovieEditionReasonSchema.nullable(),
  applied: Applied.extend({ mediaVersion: VersionSchema }),
  operationId: z.uuid().nullable(),
});
const ProtectiveFields = {
  schemaVersion: z.literal(3),
  subjectUserId: z.uuid(),
  scope: MovieEditionScopeSchema,
  requestId: z.uuid(),
  expected: z.strictObject({
    targetVersion: VersionSchema,
    requestVersion: VersionSchema,
    choiceRevision: VersionSchema,
  }),
};
export const CancelMovieRequestV3Schema = z.strictObject({
  ...ProtectiveFields,
  action: z.literal("cancel_request"),
});
export const RevokeMovieEditionChoiceV3Schema = z.strictObject({
  ...ProtectiveFields,
  action: z.literal("revoke_choice"),
});
const ProtectiveResultFields = {
  schemaVersion: z.literal(3),
  scope: MovieEditionScopeSchema,
  requestId: z.uuid(),
  choiceId: z.null(),
  applied: Applied,
};
export const CancelMovieRequestResultV3Schema = z.strictObject({
  ...ProtectiveResultFields,
  state: z.literal("cancelled"),
});
export const RevokeMovieEditionChoiceResultV3Schema = z.strictObject({
  ...ProtectiveResultFields,
  state: z.literal("pending_choice"),
});
export type MovieRequestV3 = z.infer<typeof MovieRequestV3Schema>;
export type MovieRequestResultV3 = z.infer<typeof MovieRequestResultV3Schema>;
export type CancelMovieRequestV3 = z.infer<typeof CancelMovieRequestV3Schema>;
export type CancelMovieRequestResultV3 = z.infer<
  typeof CancelMovieRequestResultV3Schema
>;
export type RevokeMovieEditionChoiceV3 = z.infer<
  typeof RevokeMovieEditionChoiceV3Schema
>;
export type RevokeMovieEditionChoiceResultV3 = z.infer<
  typeof RevokeMovieEditionChoiceResultV3Schema
>;
