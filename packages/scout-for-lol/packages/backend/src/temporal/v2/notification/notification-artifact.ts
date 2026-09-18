import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { NotificationIntentKind } from "@scout-for-lol/domain/notifications/intent.ts";
import configuration from "#src/configuration.ts";
import { readVerifiedRawObjectBytes } from "#src/report-store/s3-raw-source.ts";
import { createS3Client } from "#src/storage/s3-client.ts";
import {
  readNotificationArtifactV2,
  type ScoutV2NotificationRenderEvidence,
} from "#src/temporal/v2/notification-receipts.ts";

/**
 * The attested notification artifact, read back for the send that delivers it.
 *
 * This is the consuming half of the render/deliver split. The render Activity
 * commits this match's image on the background queue and attests to it with a
 * receipt naming the object key, its SHA-256 digest and its size; the delivery
 * Activity, on the realtime queue and in another process, has nothing but
 * that receipt to find the bytes by. Reading them back here — and proving they
 * are the bytes the receipt names — is what lets a send attach exactly what
 * was attested rather than re-rendering and hoping the two agree.
 *
 * ## The three outcomes
 *
 * A receipt that does not exist is a broken contract: the notification
 * Workflow renders before it opens its send loop, so a send with no receipt
 * to read is a send the Workflow never asked for in that order. It throws a
 * plain error, and the delivery Activity's pre-send boundary reports it as a
 * definite, retryable non-send.
 *
 * A receipt whose object is gone or whose bytes hash differently is a FACT
 * about storage, and {@link readVerifiedRawObjectBytes} says so with an
 * `ArchivedObjectUnusableError`: no retry changes it, and the delivery treats
 * it as terminal. A transport failure on the read establishes nothing about
 * the object and propagates untouched, which keeps it retryable.
 */
export type ScoutV2AttestedNotificationArtifact =
  | {
      readonly artifact: "image";
      readonly bytes: Uint8Array;
      readonly evidence: Extract<
        ScoutV2NotificationRenderEvidence,
        { artifact: "image" }
      >;
    }
  | {
      readonly artifact: "none";
      readonly evidence: Extract<
        ScoutV2NotificationRenderEvidence,
        { artifact: "none" }
      >;
    };

export async function readAttestedNotificationArtifactV2(
  riotMatchId: RiotMatchId,
  kind: NotificationIntentKind,
): Promise<ScoutV2AttestedNotificationArtifact> {
  const evidence = await readNotificationArtifactV2(riotMatchId, kind);
  if (evidence === null) {
    throw new Error(
      `No render receipt stands for ${riotMatchId}, so there is no attested artifact for this send to deliver; the Workflow renders before it sends`,
    );
  }
  if (evidence.artifact === "none") {
    return { artifact: "none", evidence };
  }
  const bucket = configuration.s3BucketName;
  if (bucket === undefined) {
    // A receipt stands but this process cannot reach the store it names. A
    // misconfiguration rather than a fact about the artifact, so it is not
    // an `ArchivedObjectUnusableError`.
    throw new Error(
      `A render receipt stands for ${riotMatchId} but no S3 bucket is configured, so the artifact it attests to cannot be read back`,
    );
  }
  const bytes = await readVerifiedRawObjectBytes({
    client: createS3Client(),
    bucket,
    key: evidence.objectKey,
    expectedDigest: evidence.digest,
  });
  if (bytes.byteLength !== evidence.bytes) {
    // Unreachable once the digest matched — SHA-256 covers the length — but
    // the receipt makes two claims and a reader that checked one of them
    // would be trusting the other.
    throw new Error(
      `The artifact for ${riotMatchId} matched its digest but not its attested size (${String(bytes.byteLength)} bytes read, ${String(evidence.bytes)} attested)`,
    );
  }
  return { artifact: "image", bytes, evidence };
}
