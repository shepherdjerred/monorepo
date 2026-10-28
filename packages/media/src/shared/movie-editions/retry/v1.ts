import { z } from "zod";
import { MovieOperationV4Schema } from "#shared/movie-editions/automation-v4.ts";
import {
  MovieEditionHashSchema as Hash,
  MovieEditionScopeSchema,
} from "#shared/movie-editions/registry.ts";

/** Internal, actual locked selection. This is not supplied as retry authority by an HTTP caller. */
export const MovieRetryCaptureV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  mode: z.enum(["manual", "automatic"]),
  attemptId: z.uuid(),
  previousCoordinatorOperationId: z.uuid(),
  birthHash: Hash,
  generation: z.int().nonnegative(),
  recoveryEpoch: z.int().nonnegative(),
  profile: z.strictObject({ id: z.uuid(), version: z.int().nonnegative() }),
});
export type MovieRetryCaptureV1 = z.infer<typeof MovieRetryCaptureV1Schema>;

export const MovieRetryClosedWorkflowV1Schema = z.strictObject({
  workflowId: z.string().min(1).max(200),
  runId: z.string().min(1).max(200),
  status: z.enum([
    "COMPLETED",
    "FAILED",
    "CANCELLED",
    "TERMINATED",
    "TIMED_OUT",
  ]),
});
export type MovieRetryClosedWorkflowV1 = z.infer<
  typeof MovieRetryClosedWorkflowV1Schema
>;

/** The receipt records fresh real observations while retaining the exact original attempt and birth. */
export const MovieRetryRenewalV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  scope: MovieEditionScopeSchema,
  input: MovieOperationV4Schema,
  capture: MovieRetryCaptureV1Schema,
  commandHash: Hash,
  previousCommandHash: Hash,
  root: MovieRetryClosedWorkflowV1Schema,
  child: MovieRetryClosedWorkflowV1Schema.nullable(),
  previousState: z.enum([
    "reserved",
    "submitting",
    "submission_unknown",
    "submission_observed",
    "downloading",
  ]),
  torrent: z
    .strictObject({
      id: z.uuid(),
      infoHash: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u),
      qbittorrentId: z.string().regex(/^[a-f0-9]{40}$/u),
      providerId: z.string().min(1).max(100),
      ownershipEpoch: z.int().nonnegative(),
      observationHash: Hash,
      savePath: z.string().min(1).max(4096),
      contentPath: z.string().min(1).max(4096),
      tags: z.string().min(1).max(4096),
      category: z.string().min(1).max(100),
      policyHash: Hash,
    })
    .nullable(),
  observedAt: z.iso.datetime(),
  sdkExpiresAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  committedAt: z.iso.datetime(),
});
export type MovieRetryRenewalV1 = z.infer<typeof MovieRetryRenewalV1Schema>;
export const MovieRetryRenewalEnvelopeV1Schema = z.strictObject({
  receipt: MovieRetryRenewalV1Schema,
  receiptHash: Hash,
});
