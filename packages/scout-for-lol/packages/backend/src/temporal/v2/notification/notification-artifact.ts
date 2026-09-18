import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { NotificationIntentKind } from "@scout-for-lol/domain/notifications/intent.ts";
import configuration from "#src/configuration.ts";
import { readVerifiedRawObjectBytes } from "#src/report-store/s3-raw-source.ts";
import { createS3Client } from "#src/storage/s3-client.ts";
import {
  readNotificationArtifactV2,
  type ScoutV2AttestedObject,
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
 * ## One reader per kind
 *
 * What a receipt may attest is decided by the kind of intent it was rendered
 * for: a post-match report is a `report`, a game-start announcement is an
 * `image` or `none` for a queue the loading screen cannot draw. So there is
 * a reader per kind, each returning only the shapes its kind can deliver,
 * and a receipt found under a kind's own receipt kind attesting anything else
 * is a {@link MalformedRenderReceiptError}: persisted data that violates the
 * contract between the render and the send. That is deterministic — the same
 * row parses the same way on every read — so the delivery treats it as
 * terminal rather than returning the intent to `ready` to re-drive the same
 * corrupt receipt every attempt.
 *
 * ## The three outcomes of a read
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

export class MalformedRenderReceiptError extends Error {
  readonly riotMatchId: RiotMatchId;
  readonly kind: NotificationIntentKind;
  readonly attested: ScoutV2NotificationRenderEvidence["artifact"];

  constructor(args: {
    riotMatchId: RiotMatchId;
    kind: NotificationIntentKind;
    evidence: ScoutV2NotificationRenderEvidence;
    expected: string;
  }) {
    super(
      `The ${args.kind} render receipt for ${args.riotMatchId} attests ${describeEvidence(args.evidence)}, which a ${args.kind} notification cannot deliver; it must attest ${args.expected}`,
    );
    this.name = "MalformedRenderReceiptError";
    this.riotMatchId = args.riotMatchId;
    this.kind = args.kind;
    this.attested = args.evidence.artifact;
  }
}

function describeEvidence(evidence: ScoutV2NotificationRenderEvidence): string {
  return evidence.artifact === "none"
    ? `no artifact (${evidence.reason})`
    : `a ${evidence.artifact}`;
}

/** The post-match report the render attested, bytes verified. */
export type ScoutV2AttestedReportArtifact = {
  readonly image: Uint8Array;
  readonly review: Uint8Array | undefined;
  readonly evidence: Extract<
    ScoutV2NotificationRenderEvidence,
    { artifact: "report" }
  >;
};

/** The loading screen the render attested, or its honest absence. */
export type ScoutV2AttestedPrematchArtifact =
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

async function requireRenderEvidence(
  riotMatchId: RiotMatchId,
  kind: NotificationIntentKind,
): Promise<ScoutV2NotificationRenderEvidence> {
  const evidence = await readNotificationArtifactV2(riotMatchId, kind);
  if (evidence === null) {
    throw new Error(
      `No ${kind} render receipt stands for ${riotMatchId}, so there is no attested artifact for this send to deliver; the Workflow renders before it sends`,
    );
  }
  return evidence;
}

/** One attested object's bytes, proven against both claims the receipt makes. */
async function readAttestedObject(
  riotMatchId: RiotMatchId,
  attested: ScoutV2AttestedObject,
): Promise<Uint8Array> {
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
    key: attested.objectKey,
    expectedDigest: attested.digest,
  });
  if (bytes.byteLength !== attested.bytes) {
    // Unreachable once the digest matched — SHA-256 covers the length — but
    // the receipt makes two claims and a reader that checked one of them
    // would be trusting the other.
    throw new Error(
      `The artifact ${attested.objectKey} for ${riotMatchId} matched its digest but not its attested size (${String(bytes.byteLength)} bytes read, ${String(attested.bytes)} attested)`,
    );
  }
  return bytes;
}

export async function readAttestedReportArtifactV2(
  riotMatchId: RiotMatchId,
): Promise<ScoutV2AttestedReportArtifact> {
  const evidence = await requireRenderEvidence(riotMatchId, "postmatch");
  if (evidence.artifact !== "report") {
    throw new MalformedRenderReceiptError({
      riotMatchId,
      kind: "postmatch",
      evidence,
      expected: "a report",
    });
  }
  const image = await readAttestedObject(riotMatchId, evidence.image);
  const review =
    evidence.review === undefined
      ? undefined
      : await readAttestedObject(riotMatchId, evidence.review);
  return { image, review, evidence };
}

export async function readAttestedPrematchArtifactV2(
  riotMatchId: RiotMatchId,
): Promise<ScoutV2AttestedPrematchArtifact> {
  const evidence = await requireRenderEvidence(riotMatchId, "prematch");
  if (evidence.artifact === "image") {
    const bytes = await readAttestedObject(riotMatchId, evidence);
    return { artifact: "image", bytes, evidence };
  }
  if (evidence.artifact === "none" && evidence.reason === "unsupported-queue") {
    return { artifact: "none", evidence };
  }
  throw new MalformedRenderReceiptError({
    riotMatchId,
    kind: "prematch",
    evidence,
    expected: "a loading screen, or no artifact for an unsupported queue",
  });
}
