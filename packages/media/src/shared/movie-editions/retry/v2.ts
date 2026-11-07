import { z } from "zod";
import {
  MovieOperationV4Schema,
  MovieAttemptOperationV4Schema,
} from "#shared/movie-editions/lifecycle/automation-v4.ts";
import {
  MovieRetryCaptureV1Schema,
  MovieRetryRenewalV1Schema,
  MovieRetryClosedWorkflowV1Schema,
} from "#shared/movie-editions/retry/v1.ts";
import { MovieEditionHashSchema as Hash } from "#shared/movie-editions/registry.ts";

/** The actual nativeAttempt projection before renewal, never a reconstructed historical snapshot. */
export const MovieRetryNativeAttemptV2Schema = z.strictObject({
  id: z.uuid(),
  releaseId: z.uuid(),
  sponsorRequestId: z.uuid().nullable(),
  mediaIds: z.tuple([z.uuid()]),
  generations: z.record(z.string(), z.int().nonnegative()),
  state: z.enum(["validating", "imported"]),
  torrentId: z.uuid(),
  operationId: z.uuid(),
  coordinatorOperationId: z.uuid(),
  failure: z.json(),
  filePlan: z.record(z.string(), z.json()),
  recoveryEpoch: z.int().nonnegative(),
});

export const MovieRetryPublicationV2Schema = z.strictObject({
  transitionId: z.uuid(),
  intentHash: Hash,
  attemptSnapshotHash: Hash,
  outcomeHash: Hash.nullable(),
});

export const MovieRetryContinuationV2Schema = z
  .strictObject({
    phase: z.enum(["prepared", "imported"]),
    filePlanHash: Hash,
    beforeAttemptHash: Hash,
    publication: MovieRetryPublicationV2Schema.nullable(),
  })
  .superRefine((value, context) => {
    if (
      value.phase === "imported" &&
      (value.publication?.outcomeHash ?? null) === null
    )
      context.addIssue({
        code: "custom",
        message:
          "Imported continuation requires its actual published physical outcome",
      });
    if (
      value.phase === "prepared" &&
      value.publication?.outcomeHash !== null &&
      value.publication !== null
    )
      context.addIssue({
        code: "custom",
        message:
          "Prepared continuation cannot reinterpret a completed physical outcome",
      });
  });

export const MovieRetryCaptureV2Schema = MovieRetryCaptureV1Schema.extend({
  schemaVersion: z.literal(2),
  continuation: MovieRetryContinuationV2Schema,
});
export type MovieRetryCaptureV2 = z.infer<typeof MovieRetryCaptureV2Schema>;

/** Imported bytes need their actual recorded transfer parent; no live qBit observation is manufactured. */
const RecordedTransferV2Schema = z.strictObject({
  kind: z.literal("physical_publication"),
  id: z.uuid(),
  infoHash: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u),
  providerId: z.string().min(1).max(100),
  ownershipEpoch: z.int().nonnegative(),
  policyHash: Hash,
});
const ObservedTransferV2Schema = z.strictObject({
  kind: z.literal("live_observation"),
  observation: MovieRetryRenewalV1Schema.shape.torrent.unwrap(),
});

export const MovieRetryRenewalV2Schema = MovieRetryRenewalV1Schema.omit({
  schemaVersion: true,
  capture: true,
  previousState: true,
  torrent: true,
})
  .extend({
    schemaVersion: z.literal(2),
    capture: MovieRetryCaptureV2Schema,
    beforeAttempt: MovieRetryNativeAttemptV2Schema,
    previousState: z.enum(["validating", "imported"]),
    transfer: z.discriminatedUnion("kind", [
      RecordedTransferV2Schema,
      ObservedTransferV2Schema,
    ]),
  })
  .superRefine((value, context) => {
    if (
      value.previousState !== value.beforeAttempt.state ||
      (value.previousState === "validating") !==
        (value.capture.continuation.phase === "prepared") ||
      (value.previousState === "imported") !==
        (value.transfer.kind === "physical_publication")
    )
      context.addIssue({
        code: "custom",
        message:
          "Movie continuation must retain its actual transfer and physical phase",
      });
  });
export type MovieRetryRenewalV2 = z.infer<typeof MovieRetryRenewalV2Schema>;
export const MovieRetryRenewalEnvelopeV2Schema = z.strictObject({
  receipt: MovieRetryRenewalV2Schema,
  receiptHash: Hash,
});

/** No coordinator renewal: this identifies the already committed Plex receipt by its original input. */
export const MovieRetryPlexAcknowledgementV1Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    command: MovieOperationV4Schema,
    originalInput: MovieAttemptOperationV4Schema,
    originalReceiptHash: Hash,
    originalCommandHash: Hash,
    kind: z.enum(["historical_ack", "finalization"]),
    terminal: z
      .strictObject({
        root: MovieRetryClosedWorkflowV1Schema,
        child: MovieRetryClosedWorkflowV1Schema,
      })
      .nullable(),
    completed: z.literal(true),
  })
  .refine(
    (value) => (value.kind === "historical_ack") === (value.terminal === null),
    "Only actual completed history may acknowledge without predecessor observations",
  );

export const MovieRetryPlexCaptureV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  mode: z.enum(["manual", "automatic"]),
  originalInput: MovieAttemptOperationV4Schema,
  originalReceiptHash: Hash,
  originalCommandHash: Hash,
  birthHash: Hash,
  generation: z.int().nonnegative(),
  recoveryEpoch: z.int().nonnegative(),
});
export type MovieRetryPlexCaptureV1 = z.infer<
  typeof MovieRetryPlexCaptureV1Schema
>;
