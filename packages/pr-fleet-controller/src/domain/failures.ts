export function normalizeFailure(failure: unknown): Error {
  return failure instanceof Error
    ? failure
    : new Error("Non-Error controller failure", { cause: failure });
}

export function combineFailures(
  current: Error | undefined,
  failure: unknown,
): Error {
  const next = normalizeFailure(failure);
  if (current === undefined || current === next) {
    return next;
  }
  return new AggregateError(
    [current, next],
    "Controller and shutdown both failed",
    { cause: next },
  );
}
