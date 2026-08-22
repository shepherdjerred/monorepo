import { describe, test } from "vitest";

import { groupByDescribe, scenariosFrom } from "./fixtures/load";
import { runScenario } from "./fixtures/runner";

/**
 * End-to-end scenarios over the deterministic harness. Each one tells one
 * story from the 2026-07-02 system review — the situations the old sync layer
 * lost data in.
 *
 * The stories are data: `packages/tasknotes-fixtures/scenarios` holds them as
 * language-neutral JSON so the TypeScript engine and the forthcoming Rust
 * core run the identical corpus. That shared corpus IS the anti-drift
 * mechanism between the two implementations, so a scenario that cannot be
 * expressed in the fixture format must be raised loudly, never quietly
 * dropped — see `non-portable.test.ts` for the one such case.
 */

const SOURCE = "src/data/sync/__tests__/offline-scenarios.test.ts";

for (const [title, scenarios] of groupByDescribe(scenariosFrom(SOURCE))) {
  describe(title, () => {
    for (const scenario of scenarios) {
      test(scenario.name, async () => {
        await runScenario(scenario);
      });
    }
  });
}
