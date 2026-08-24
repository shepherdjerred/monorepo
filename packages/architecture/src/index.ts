import {
  type ArchitectureDefinition,
  resolveArchitecture,
} from "#src/definition.ts";
import {
  type ArchitectureCheckResult,
  type FixtureCruiseResult,
  checkArchitecture as cruiseSourceTree,
  cruiseArchitectureFixtures as cruiseFixtures,
} from "#src/cruise.ts";
import { expectedFixtureRuleNames as fixtureRuleNamesFor } from "#src/rules.ts";

/**
 * Pins the type of an `architecture.config.ts` default export. Validation
 * happens when the definition is used, so a config loaded dynamically by the
 * CLI is checked at runtime too.
 */
export function defineArchitecture(
  definition: ArchitectureDefinition,
): ArchitectureDefinition {
  return definition;
}

/** Enforce a package's architecture against its real source tree. */
export async function checkArchitecture(options: {
  packageRoot: string;
  definition: unknown;
}): Promise<ArchitectureCheckResult> {
  return cruiseSourceTree(options);
}

/**
 * Run the derived fixture rules against a package's committed negative
 * fixtures — the proof that its boundary rules can actually fail.
 */
export async function cruiseArchitectureFixtures(options: {
  packageRoot: string;
  definition: unknown;
  fixtureRoot?: string;
}): Promise<FixtureCruiseResult> {
  return cruiseFixtures(options);
}

/**
 * Every fixture rule name a complete negative-fixture suite has to trigger.
 * Pair it with {@link cruiseArchitectureFixtures} in a package's meta-test so
 * that adding a boundary without a fixture fails the suite.
 */
export function expectedFixtureRuleNames(definition: unknown): string[] {
  return fixtureRuleNamesFor(resolveArchitecture(definition));
}
