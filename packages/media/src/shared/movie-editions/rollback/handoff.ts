import { z } from "zod";
import {
  MovieEditionHashSchema,
  MovieEditionScopeSchema,
} from "#shared/movie-editions/registry.ts";
import { MovieRetryClosedWorkflowV1Schema } from "#shared/movie-editions/retry/v1.ts";
import {
  MovieRollbackRetryOperationV1Schema,
  MovieRollbackRetryExpectedV1Schema,
} from "./retry.ts";
import { MovieRollbackHandoffRefV1Schema } from "./handoff-reference.ts";
import { MoviePublicationAssetV2Schema } from "#shared/movie-editions/publication-v2.ts";

const Owner = z.strictObject({
  workflowId: z.string().min(1),
  runId: z.string().min(1),
  activityId: z.string().min(1),
});
/** One exact execution handoff; it cannot change the admitted inverse or renew
 * any of its immutable clocks, source/cleanup identities or consent. */
export const MovieRollbackHandoffV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.uuid(),
  transactionId: z.string().regex(/^\d+$/u),
  operationId: z.uuid(),
  intentId: z.uuid(),
  intentHash: MovieEditionHashSchema,
  scope: MovieEditionScopeSchema,
  input: MovieRollbackRetryOperationV1Schema,
  commandHash: MovieEditionHashSchema,
  commandRaw: z.string().min(1),
  actorId: z.uuid(),
  expected: MovieRollbackRetryExpectedV1Schema,
  predecessor: MoviePublicationAssetV2Schema,
  predecessorRaw: z.string().min(1),
  successor: MoviePublicationAssetV2Schema,
  successorRaw: z.string().min(1),
  previous: MovieRollbackHandoffRefV1Schema.nullable(),
  previousOwner: Owner,
  closedOwner: MovieRetryClosedWorkflowV1Schema,
  closedSourceRoot: MovieRetryClosedWorkflowV1Schema.nullable(),
  owner: Owner,
  observedAt: z.iso.datetime(),
  sdkExpiresAt: z.iso.datetime(),
  writerExpiresAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  grantedAt: z.iso.datetime(),
});
export type MovieRollbackHandoffV1 = z.infer<
  typeof MovieRollbackHandoffV1Schema
>;
