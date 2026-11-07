import { z } from "zod";
import { MovieAttemptOperationV4Schema } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import { MoviePlexReceiptV2Schema } from "#shared/movie-editions/plex-v2.ts";
import { MoviePlexReceiptV3Schema } from "#shared/movie-editions/management/plex.ts";
import { PlexBindingExpectedSchema } from "#shared/plex-binding/expected.ts";
import { PlexVerificationProtectedSchema } from "#shared/plex-binding/observations.ts";
import { MovieEditionHashSchema as Hash } from "#shared/movie-editions/registry.ts";

/** An actual rejected read, distinct from absence of a successful completion. */
export const MoviePlexRejectionV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.uuid(),
  transactionId: z.string().regex(/^[1-9]\d*$/u),
  commandPayloadRaw: z.string().min(1),
  identityRaw: z.string().min(1),
  birthRaw: z.string().min(1),
  generationsRaw: z.string().min(1),
  input: MovieAttemptOperationV4Schema,
  command: MoviePlexReceiptV2Schema.shape.command,
  attempt: z.union([
    MoviePlexReceiptV2Schema.shape.attempt,
    MoviePlexReceiptV3Schema.shape.attempt,
  ]),
  publication: MoviePlexReceiptV2Schema.shape.publication,
  expected: PlexBindingExpectedSchema,
  observation: PlexVerificationProtectedSchema,
  sdk: z.strictObject({
    observedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  }),
  writerExpiresAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
});
export const MoviePlexRejectionEnvelopeV1Schema = z.strictObject({
  receipt: MoviePlexRejectionV1Schema,
  receiptHash: Hash,
  raw: z.string().min(1),
});
export type MoviePlexRejectionV1 = z.infer<typeof MoviePlexRejectionV1Schema>;
