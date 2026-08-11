import { runActions } from "./actions";
import { checkAssertion } from "./assertions";
import type { Scenario } from "./schema";

/**
 * Executes a language-neutral scenario fixture against the deterministic
 * harness.
 *
 * The contract a second implementation (the Rust core) must match is exactly
 * the vocabulary in `./schema.ts`: seventeen actions, seventeen assertions.
 * Nothing here may consult anything the fixture did not say — the corpus only
 * guards against drift if both runners see identical inputs.
 *
 * - `./world.ts` — the simulated world and the pure lookups
 * - `./actions.ts` — the action verbs
 * - `./assertions.ts` — the assertion kinds
 */
export async function runScenario(scenario: Scenario): Promise<void> {
  const state = await runActions(scenario);
  for (const assertion of scenario.assertions) {
    await checkAssertion(scenario, state, assertion);
  }
}
