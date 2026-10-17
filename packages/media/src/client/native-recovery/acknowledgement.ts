type ReviewIdentity = {
  id: string;
  version: number;
  planHash: string | null;
  scope: { request: { recoveryEpoch: number; runtimeVersion: number } };
};

/** An acknowledgement belongs to the exact displayed proof, never just its route. */
export function nativeReviewIdentity(
  review: ReviewIdentity | undefined,
): string | null {
  if (review?.planHash == null) return null;
  return JSON.stringify([
    review.id,
    review.version,
    review.planHash,
    review.scope.request.recoveryEpoch,
    review.scope.request.runtimeVersion,
  ]);
}

export function nativeReviewAcknowledged(
  acknowledgement: string | null,
  review: ReviewIdentity | undefined,
): boolean {
  return (
    acknowledgement !== null && acknowledgement === nativeReviewIdentity(review)
  );
}
