import { describe, test } from "bun:test";

import { groupByDescribe, scenariosFrom } from "./fixtures/load";
import { runScenario } from "./fixtures/runner";

/**
 * Meta-tests pinning the harness contract — the `FakeServer` wire behavior
 * every higher-level scenario leans on, plus the determinism and
 * crash-simulation properties of the simulation itself.
 *
 * The scenarios themselves live as language-neutral JSON in
 * `packages/tasknotes-fixtures/scenarios`, so the forthcoming Rust core runs
 * the identical corpus. See `fixtures/schema.ts` for the format and
 * `fixtures/runner.ts` for the executor.
 */

const SOURCE = "src/data/sync/__tests__/harness.test.ts";

for (const [title, scenarios] of groupByDescribe(scenariosFrom(SOURCE))) {
  describe(title, () => {
    for (const scenario of scenarios) {
      test(scenario.name, async () => {
        await runScenario(scenario);
      });
    }
  });
}
