/**
 * Run a bounded worker set and wait for every worker to stop before exposing a
 * failure. Temporal may retry as soon as the Activity rejects, so returning
 * while siblings still perform Riot or storage work would overlap attempts.
 */
export async function runSettledWorkers(
  count: number,
  worker: () => Promise<void>,
): Promise<void> {
  const results = await Promise.allSettled(
    Array.from({ length: count }, worker),
  );
  const failure = results.find((result) => result.status === "rejected");
  if (failure !== undefined) throw failure.reason;
}
