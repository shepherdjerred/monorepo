export type WorkerPhaseLog = (line: string) => void;

const stderrLine: WorkerPhaseLog = (line) => {
  console.warn(line);
};

/**
 * Time one worker release phase and write a structured JSON line to the Job
 * log, so a slow preflight or step shows where its time went. The phase's
 * outcome is reported and its error is rethrown unchanged.
 */
export async function timedWorkerPhase<T>(
  phase: string,
  detail: Readonly<Record<string, string>>,
  work: () => Promise<T>,
  log: WorkerPhaseLog = stderrLine,
): Promise<T> {
  const started = performance.now();
  let outcome: "passed" | "failed" = "failed";
  try {
    const result = await work();
    outcome = "passed";
    return result;
  } finally {
    log(
      JSON.stringify({
        kind: "worker-release-phase",
        phase,
        ...detail,
        outcome,
        durationMs: Math.round(performance.now() - started),
      }),
    );
  }
}
