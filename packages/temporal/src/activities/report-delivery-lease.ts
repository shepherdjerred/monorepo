import { z } from "zod/v4";
import {
  REPORT_SEND_CLAIM_TAKEOVER_MS,
  REPORT_SEND_DEADLINE_MS,
} from "#shared/report-delivery-policy.ts";

/**
 * Exclusive ownership of a report's Postal send.
 *
 * Postal has no idempotency key, so "did the previous attempt already send
 * this?" cannot be answered from the provider. A stored `pending` delivery
 * state cannot answer it either: Temporal starts a new attempt once
 * start-to-close elapses, which can be while the previous attempt sits between
 * its Postal call and its state write. Reading pending as "not sent"
 * duplicates the email; reading it as "sent" drops a report whose owner died
 * first. So ownership is taken explicitly instead, and every timestamp here is
 * on ONE clock — the start of the activity attempt that holds the lease.
 */
export const ReportSendClaimV1Schema = z.object({
  schemaVersion: z.literal(1),
  reportRunId: z.string().min(1),
  owner: z.string().min(1),
  claimedAt: z.iso.datetime({ offset: true }),
});

export type ReportSendClaimV1 = z.infer<typeof ReportSendClaimV1Schema>;

export type ReportSendClaimBackend = {
  readSendClaim: (
    key: string,
  ) => Promise<{ claim: ReportSendClaimV1; etag: string } | undefined>;
  /**
   * Conditional write. `expectedEtag` undefined means "only if absent".
   * Returns false when the precondition failed, i.e. another attempt owns the
   * send — never throws for contention.
   */
  writeSendClaim: (
    key: string,
    claim: ReportSendClaimV1,
    expectedEtag: string | undefined,
  ) => Promise<boolean>;
};

export function reportSendClaimKey(stateKey: string): string {
  return `${stateKey.replace(/\.json$/, "")}.send-claim.json`;
}

/**
 * Milliseconds this attempt may still spend talking to Postal before its lease
 * becomes takeable. Non-positive means the attempt must not send at all.
 *
 * Measured from attempt start rather than from the call, because slow
 * pre-send work would otherwise push the deadline past the takeover point and
 * let a replaced owner deliver a second copy of the report.
 */
export function reportSendRemainingMs(
  attemptStartedAt: string,
  now: string,
): number {
  return (
    REPORT_SEND_DEADLINE_MS - (Date.parse(now) - Date.parse(attemptStartedAt))
  );
}

/**
 * Take exclusive ownership of this report's send. Resolves false when a
 * different attempt holds a lease that has not yet expired.
 */
export async function claimReportSend(input: {
  backend: ReportSendClaimBackend;
  claimKey: string;
  reportRunId: string;
  owner: string;
  attemptStartedAt: string;
}): Promise<boolean> {
  const claim = ReportSendClaimV1Schema.parse({
    schemaVersion: 1,
    reportRunId: input.reportRunId,
    owner: input.owner,
    claimedAt: input.attemptStartedAt,
  });
  const held = await input.backend.readSendClaim(input.claimKey);
  if (held === undefined) {
    return input.backend.writeSendClaim(input.claimKey, claim, undefined);
  }
  if (held.claim.owner === input.owner) {
    return true;
  }
  // Aged from this attempt's start, not from wall-clock now: both ends of the
  // comparison are then attempt starts, which is exactly what the retry
  // schedule in report-delivery-policy.ts is proven against.
  const heldFor =
    Date.parse(input.attemptStartedAt) - Date.parse(held.claim.claimedAt);
  if (heldFor < REPORT_SEND_CLAIM_TAKEOVER_MS) {
    return false;
  }
  return input.backend.writeSendClaim(input.claimKey, claim, held.etag);
}
