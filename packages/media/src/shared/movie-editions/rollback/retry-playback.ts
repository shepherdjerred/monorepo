import { z } from "zod";
import { MovieEditionHashSchema } from "#shared/movie-editions/registry.ts";
import { PlexMovieAssociationV2Schema } from "#shared/plex-binding/contract.ts";
import { MovieRollbackRetryOperationV1Schema } from "./retry.ts";
import { MovieRollbackHandoffRefV1Schema } from "./handoff-reference.ts";

/** Automatic takeover observes sessions against admitted paths and historical
 * item identity. It never claims successful or freshly verified B serving. */
export const MovieRollbackRetryPlaybackV1Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: z.uuid(),
    transactionId: z.string().regex(/^[1-9]\d*$/u),
    operationId: z.uuid(),
    intentId: z.uuid(),
    intentHash: MovieEditionHashSchema,
    input: MovieRollbackRetryOperationV1Schema,
    handoff: MovieRollbackHandoffRefV1Schema,
    commandRaw: z.string().min(1),
    commandHash: MovieEditionHashSchema,
    originalAssociation: PlexMovieAssociationV2Schema,
    paths: z.array(z.string().min(1)).min(1).max(1000),
    pathsRaw: z.string().min(1),
    pathsHash: MovieEditionHashSchema,
    sessions: z.strictObject({
      state: z.literal("clear"),
      checkedAt: z.iso.datetime(),
      pathsHash: MovieEditionHashSchema,
    }),
    sdk: z.strictObject({
      observedAt: z.iso.datetime(),
      expiresAt: z.iso.datetime(),
    }),
    writerExpiresAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    completedAt: z.iso.datetime(),
  })
  .refine((guard) => {
    const observed = Date.parse(guard.sdk.observedAt),
      expires = Date.parse(guard.expiresAt);
    return (
      Date.parse(guard.sessions.checkedAt) >= observed &&
      Date.parse(guard.completedAt) >= Date.parse(guard.sessions.checkedAt) &&
      Date.parse(guard.completedAt) < expires &&
      expires <=
        Math.min(
          observed + 60_000,
          Date.parse(guard.sdk.expiresAt),
          Date.parse(guard.writerExpiresAt),
        )
    );
  }, "Automatic rollback retry playback must preserve its actual original SDK/writer clock");
