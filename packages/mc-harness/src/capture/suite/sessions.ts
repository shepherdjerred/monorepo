import type { SuiteScenario } from "./define.ts";

type Session = {
  prepare: (scenario: SuiteScenario) => Promise<void>;
  stop: () => Promise<unknown>;
};

/** A rejected real-time recording can be retaken; gameplay and cleanup errors cannot. */
function missedRecordingFrame(error: unknown): string | undefined {
  return error instanceof Error &&
    /^capture-[a-f0-9-]{36}: java\.lang\.IllegalStateException: Rendered capture missed frame \d+$/u.test(
      error.message,
    )
    ? error.message
    : undefined;
}

/** Results become available to publication only after every owned session is stopped. */
export async function runScenarioSessions<S extends Session, R>(
  scenarios: SuiteScenario[],
  start: (scenario: SuiteScenario) => Promise<S>,
  execute: (scenario: SuiteScenario, session: S) => Promise<R>,
): Promise<R[]> {
  let session: S | undefined;
  const results: R[] = [];
  const stop = async () => {
    const owned = session;
    session = undefined;
    await owned?.stop();
  };
  const capture = async (scenario: SuiteScenario): Promise<R> => {
    for (let attempt = 0; ; attempt++) {
      session ??= await start(scenario);
      await session.prepare(scenario);
      try {
        return await execute(scenario, session);
      } catch (error) {
        const rejected = missedRecordingFrame(error);
        if (attempt !== 0 || rejected === undefined) throw error;
        // Discard all mutated state before retaking the entire scenario. The
        // failed clip stays failed; the new recording must pass every gate.
        await stop();
        process.stderr.write(
          JSON.stringify({
            event: "capture-frame-retake",
            scenario: scenario.id,
            rejected,
          }) + "\n",
        );
      }
    }
  };
  try {
    for (const scenario of scenarios) {
      if (scenario.isolation === "fresh") {
        await stop();
      }
      results.push(await capture(scenario));
      if (scenario.isolation === "fresh") {
        await stop();
      }
    }
    return results;
  } finally {
    await stop();
  }
}
