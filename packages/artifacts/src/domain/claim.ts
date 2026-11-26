export type ClaimCandidate = {
  /** Null while no agent has claimed the comment. */
  delivery: {
    actorId: string;
    actorLastSeenAt: Date;
    ackedAt: Date | null;
  } | null;
};

export type ClaimPolicy = {
  now: Date;
  actorId: string;
  orphanMs: number;
};

export type ClaimDecision = "claim" | "retry" | "takeover" | "skip";

/**
 * Whether the caller may take a settled human comment on an open thread that
 * no agent has handled. The query locks candidate rows; this decides:
 *
 * - unclaimed: claim it;
 * - claimed by the caller and not acknowledged: deliver it again (`retry`);
 * - claimed by the caller and acknowledged: never again, so the next `wait`
 *   returns only newer comments;
 * - held by another actor that has not been seen for `orphanMs`: `takeover`,
 *   which is how a resumed session inherits a dead one's feedback;
 * - otherwise it belongs to a live actor: skip.
 */
export function claimDecision(
  candidate: ClaimCandidate,
  policy: ClaimPolicy,
): ClaimDecision {
  const held = candidate.delivery;
  if (held === null) return "claim";
  if (held.actorId === policy.actorId)
    return held.ackedAt === null ? "retry" : "skip";
  const silentFor = policy.now.getTime() - held.actorLastSeenAt.getTime();
  return silentFor > policy.orphanMs ? "takeover" : "skip";
}

/** When a comment last edited at `updatedAt` becomes deliverable. */
export function deliverableAt(updatedAt: Date, settleSeconds: number): Date {
  return new Date(updatedAt.getTime() + settleSeconds * 1000);
}
