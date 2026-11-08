import { z } from "zod";
import { ClosedCoordinatorObservationSchema } from "#shared/publication-proof/references.ts";
import { PublicationHashSchema } from "#shared/publication-proof/effects.ts";

/** Execution replacement only. The original approval, inverse namespace,
 * admission, physical acknowledgments and completion retain their identities. */
export const SeriesPackNativeRetryV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  continuationId: z.uuid(),
  descriptorHash: PublicationHashSchema,
  recoveryEpoch: z.int().nonnegative(),
  previousVersion: z.int().nonnegative(),
  phase: z.enum(["physical", "publication"]),
  previousWorkflowClosed: ClosedCoordinatorObservationSchema,
  operationId: z.uuid(),
  actorId: z.uuid(),
  transactionId: z.string().regex(/^[1-9]\d*$/u),
  observedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
