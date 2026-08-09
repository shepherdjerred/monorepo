import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import type { Scenario } from "./schema";
import { ScenarioSchema } from "./schema";

/**
 * Reads the scenario corpus from `packages/tasknotes-fixtures`.
 *
 * The corpus is loaded off disk rather than imported, for the same reason the
 * Rust runner will: it is language-neutral data, not a TypeScript module. The
 * fixtures package is deliberately NOT a dependency of this app — the Rust
 * core must be able to consume the same files without the React Native
 * package existing.
 */

export const FIXTURES_ROOT = path.join(
  __dirname,
  "../../../../../../tasknotes-fixtures",
);

export const SCENARIOS_DIR = path.join(FIXTURES_ROOT, "scenarios");

export const SCHEMA_PATH = path.join(
  FIXTURES_ROOT,
  "schema",
  "scenario.schema.json",
);

function scenarioFiles(): string[] {
  return readdirSync(SCENARIOS_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b, "en"));
}

export function readRawScenarios(): { file: string; raw: unknown }[] {
  return scenarioFiles().map((file) => {
    const raw: unknown = JSON.parse(
      readFileSync(path.join(SCENARIOS_DIR, file), "utf8"),
    );
    return { file, raw };
  });
}

/** Every scenario, parsed and ordered by file name. Throws on any drift. */
export function loadScenarios(): Scenario[] {
  return readRawScenarios().map(({ file, raw }) => {
    const parsed = ScenarioSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `${file} is not a valid scenario: ${JSON.stringify(parsed.error.issues, null, 2)}`,
      );
    }
    if (parsed.data.id !== file.replace(/\.json$/u, "")) {
      throw new Error(`${file} declares mismatched id "${parsed.data.id}"`);
    }
    return parsed.data;
  });
}

/** The scenarios a given test file owns, in fixture order. */
export function scenariosFrom(source: string): Scenario[] {
  const owned = loadScenarios().filter(
    (scenario) => scenario.source === source,
  );
  if (owned.length === 0) {
    throw new Error(`no scenario fixture declares source "${source}"`);
  }
  return owned;
}

/**
 * Scenarios bucketed by their `describe` title, in first-appearance order, so
 * the generated suite reads like the hand-written one it replaced.
 */
export function groupByDescribe(
  scenarios: readonly Scenario[],
): [string, Scenario[]][] {
  const groups = new Map<string, Scenario[]>();
  for (const scenario of scenarios) {
    const existing = groups.get(scenario.describe);
    if (existing === undefined) groups.set(scenario.describe, [scenario]);
    else existing.push(scenario);
  }
  return [...groups.entries()];
}
