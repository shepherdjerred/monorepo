// Error objects preserve original worker stacks/causes across structured clone.
// The string fields also keep the protocol useful for non-Error rejections.
export function workerErrorEnvelope(cause) {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  const causes = [],
    seen = new Set([error]);
  let current = error.cause;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    causes.push({
      name: current.name,
      message: current.message,
      stack: current.stack ?? null,
    });
    current = current.cause;
  }
  return {
    name: error.name,
    message: error.message,
    stack: error.stack ?? null,
    cause: error,
    causes,
  };
}

export function restoreWorkerError(envelope) {
  if (
    !envelope ||
    typeof envelope.name !== "string" ||
    typeof envelope.message !== "string" ||
    (envelope.stack !== undefined &&
      envelope.stack !== null &&
      typeof envelope.stack !== "string") ||
    (envelope.cause !== undefined &&
      envelope.cause !== null &&
      !(envelope.cause instanceof Error))
  )
    throw Error("Invalid worker error response");
  const error = new Error(envelope.message, { cause: envelope.cause });
  error.name = envelope.name;
  if (typeof envelope.stack === "string") error.stack = envelope.stack;
  if (envelope.causes !== undefined) {
    if (
      !Array.isArray(envelope.causes) ||
      envelope.causes.some(
        (item) =>
          !item ||
          typeof item.name !== "string" ||
          typeof item.message !== "string" ||
          (item.stack !== null && typeof item.stack !== "string"),
      )
    )
      throw Error("Invalid worker causal error response");
    let causal;
    for (let index = envelope.causes.length - 1; index >= 0; index--) {
      const item = envelope.causes[index],
        next = new Error(item.message, { cause: causal });
      next.name = item.name;
      if (typeof item.stack === "string") next.stack = item.stack;
      causal = next;
    }
    if (causal !== undefined && envelope.cause instanceof Error)
      Object.defineProperty(envelope.cause, "cause", {
        value: causal,
        configurable: true,
        writable: true,
      });
  }
  return error;
}
