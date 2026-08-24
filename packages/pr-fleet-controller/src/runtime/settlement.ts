/**
 * Await a set of independent settlements and surface every failure.
 *
 * Lives below the controller and the CLI because both settle resources they
 * own: the controller settles workers, the CLI settles the controller and the
 * telemetry runtime. Neither may swallow a failure raised by a sibling, so the
 * failures are collected rather than short-circuited.
 */
export async function settleAllOrThrow(
  settlements: Iterable<Promise<unknown>>,
): Promise<void> {
  const results = await Promise.all(
    [...settlements].map(async (settlement) => {
      try {
        await settlement;
        return { status: "completed" } as const;
      } catch (error) {
        return { status: "failed", error } as const;
      }
    }),
  );
  const failures: unknown[] = [];
  for (const result of results) {
    if (result.status === "failed") {
      failures.push(result.error);
    }
  }
  if (failures.length === 1) {
    throw failures[0];
  }
  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      "Multiple asynchronous settlements failed",
    );
  }
}
