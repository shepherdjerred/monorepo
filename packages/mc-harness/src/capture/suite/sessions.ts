import type { SuiteScenario } from "./define.ts";

type Session = {
  prepare: (scenario: SuiteScenario) => Promise<void>;
  stop: () => Promise<unknown>;
};

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
  try {
    for (const scenario of scenarios) {
      if (scenario.isolation === "fresh") {
        await stop();
      }
      session ??= await start(scenario);
      await session.prepare(scenario);
      results.push(await execute(scenario, session));
      if (scenario.isolation === "fresh") {
        await stop();
      }
    }
    return results;
  } finally {
    await stop();
  }
}
