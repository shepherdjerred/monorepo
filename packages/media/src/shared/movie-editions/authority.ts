import { z } from "zod";
import { VersionSchema } from "#shared/contract.ts";
import { MovieEditionHashSchema, MovieEditionKeySchema } from "./registry.ts";

/** Historical attribution evidence, not a substitute for current authorization. */
export const MovieEditionChoiceAuditSchema = z.strictObject({
  schemaVersion: z.literal(1),
  mode: z.enum(["self", "managed_owner"]),
  actorVersion: VersionSchema,
  subjectVersion: VersionSchema,
  mappingVersion: VersionSchema,
  serverMachineId: z.string().min(1),
  homeUserId: z.string().min(1).nullable(),
  serverAccountId: z.string().min(1).nullable(),
});

/** Written only in a new movie attempt INSERT; SQL enforces immutable birth. */
export const MovieEditionBirthAuthoritySchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    choiceId: z.uuid(),
    choiceRevision: z.int().positive(),
    sponsorRequestId: z.uuid(),
    requestVersionAtCapture: VersionSchema,
    rootMediaId: z.uuid(),
    mediaId: z.uuid(),
    edition: MovieEditionKeySchema,
    definitionVersion: z.literal(0),
    definitionDigest: MovieEditionHashSchema,
    targetGenerationAtCapture: VersionSchema,
    actorId: z.uuid(),
    subjectUserId: z.uuid(),
  })
  .refine(
    (value) => value.rootMediaId === value.mediaId,
    "Movie attempt authority must bind one canonical movie",
  );
export type MovieEditionChoiceAudit = z.infer<
  typeof MovieEditionChoiceAuditSchema
>;
export type MovieEditionBirthAuthority = z.infer<
  typeof MovieEditionBirthAuthoritySchema
>;
