import { z } from "zod";
import { FilePlanEntrySchema } from "#shared/file-plan.ts";
import { FileIdentityEvidenceSchema } from "#shared/acquisition/identity.ts";
import { MovieEditionBirthAuthoritySchema } from "./authority.ts";
import { MovieEditionScopeSchema } from "./registry.ts";
import { MovieCutEvidenceV2Schema, movieCutMatches } from "./cut-v2.ts";

/** Explicitly versioned movie plans; the historical array format is left literal. */
export const MovieFilePlanEntryV2Schema = FilePlanEntrySchema.strict().extend({
  previousSidecars: FilePlanEntrySchema.shape.previousSidecars
    .max(100)
    .refine(
      (items) =>
        new Set(items.map((item) => item.subtitleId)).size === items.length,
      "Movie predecessor sidecars must be distinct",
    ),
  embeddedSubtitles: FilePlanEntrySchema.shape.embeddedSubtitles
    .max(100)
    .refine(
      (items) => new Set(items.map((item) => item.id)).size === items.length,
      "Movie embedded subtitle identities must be distinct",
    ),
  identityEvidence: FileIdentityEvidenceSchema.extend({
    parsedCoordinates: z.strictObject({ kind: z.literal("movie") }),
  }),
  editionEvidence: z.strictObject({
    candidate: MovieCutEvidenceV2Schema,
    member: MovieCutEvidenceV2Schema,
  }),
});
const MovieFilePlanV2BaseSchema = z.strictObject({
  schemaVersion: z.literal(2),
  attemptId: z.uuid(),
  scope: MovieEditionScopeSchema,
  birth: MovieEditionBirthAuthoritySchema,
  entries: z.tuple([MovieFilePlanEntryV2Schema]),
});

function scopeMatches(plan: z.infer<typeof MovieFilePlanV2BaseSchema>) {
  const entry = plan.entries[0];
  const identity = entry.identityEvidence;
  return (
    plan.birth.mediaId === plan.scope.mediaId &&
    plan.birth.rootMediaId === plan.scope.rootMediaId &&
    plan.birth.edition === plan.scope.edition &&
    entry.libraryKind === "movies" &&
    entry.mediaIds.length === 1 &&
    entry.mediaIds[0] === plan.scope.mediaId &&
    identity.coverage.length === 1 &&
    identity.coverage[0] === plan.scope.mediaId &&
    Object.keys(entry.generations).length === 1 &&
    identity.sourceFile.sizeBytes === entry.sizeBytes &&
    entry.generations[plan.scope.mediaId] ===
      plan.birth.targetGenerationAtCapture
  );
}

function memberMatches(plan: z.infer<typeof MovieFilePlanV2BaseSchema>) {
  const entry = plan.entries[0];
  const identity = entry.identityEvidence;
  const { candidate, member } = entry.editionEvidence;
  return (
    candidate.source.kind === "provider" &&
    member.source.kind === "member" &&
    member.source.attemptId === plan.attemptId &&
    member.source.torrentFileIndex === identity.sourceFile.torrentFileIndex &&
    candidate.canonicalDigest === member.canonicalDigest &&
    member.texts.length === 1 &&
    member.texts[0]?.text === identity.sourceFile.relativePath &&
    movieCutMatches(plan.scope.edition, candidate.conclusion) &&
    movieCutMatches(plan.scope.edition, member.conclusion)
  );
}

export const MovieFilePlanV2Schema = MovieFilePlanV2BaseSchema.superRefine(
  (plan, ctx) => {
    if (!scopeMatches(plan))
      ctx.addIssue({
        code: "custom",
        message: "Movie plan lost its exact birth scope or generation",
      });
    if (!memberMatches(plan))
      ctx.addIssue({
        code: "custom",
        message: "Movie cut evidence belongs to a different release or member",
      });
  },
);
export type MovieFilePlanV2 = z.infer<typeof MovieFilePlanV2Schema>;
export type MovieFilePlanEntryV2 = z.infer<typeof MovieFilePlanEntryV2Schema>;
