import { z } from "zod";
import {
  MovieEditionScopeSchema,
  MovieEditionHashSchema,
} from "#shared/movie-editions/registry.ts";
import { PublicationParticipantSchema } from "#shared/publication-proof/intent.ts";
import { PublicationJournalSchema } from "#shared/publication-proof/effects.ts";

/** Mechanical input only. The actual immutable rollback admission and original
 * invocation capabilities supply authority; this is never a publication intent. */
export const MovieRollbackCaptionIORefV1Schema = z
  .strictObject({
    kind: z.literal("movie_rollback_captions_v1"),
    transitionId: z.uuid(),
    intentHash: MovieEditionHashSchema,
    scope: MovieEditionScopeSchema,
    assetId: z.uuid(),
    participants: z.array(PublicationParticipantSchema).min(1).max(256),
    journals: z.array(PublicationJournalSchema).max(64),
  })
  .refine(
    (input) =>
      input.participants.every(
        (participant) =>
          participant.libraryKind === "movies" &&
          participant.assetId === input.assetId &&
          participant.subtitleId !== null,
      ),
    "Rollback caption mechanics must retain their exact owned movie caption baseline",
  );
export type MovieRollbackCaptionIORefV1 = z.infer<
  typeof MovieRollbackCaptionIORefV1Schema
>;
