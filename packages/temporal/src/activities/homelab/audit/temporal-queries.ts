export function temporalHealthQueries(now: Date): {
  failed: string;
  stalled: string;
} {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const stalledSince = new Date(
    now.getTime() - 6 * 60 * 60 * 1000,
  ).toISOString();
  return {
    failed: `ExecutionStatus IN ("Failed", "TimedOut") AND CloseTime > "${since}"`,
    stalled: `ExecutionStatus = "Running" AND StartTime < "${stalledSince}"`,
  };
}
