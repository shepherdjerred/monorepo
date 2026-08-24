import type { IRegularForbiddenRuleType } from "dependency-cruiser";
import {
  CIRCULAR_RULE_NAME,
  FIXTURE_RULE_PREFIX,
  type LayerBoundary,
  type ResolvedArchitecture,
} from "#src/definition.ts";

/**
 * Runtime import cycles only. `viaOnly` drops cycles that are closed by an
 * `import type`: those vanish at compile time and cannot deadlock a module
 * initialisation order, so failing a build on them would be noise.
 */
function circularRule(): IRegularForbiddenRuleType {
  return {
    name: CIRCULAR_RULE_NAME,
    comment:
      "A runtime import cycle makes module initialisation order significant, which is a latent " +
      "crash. Break it by extracting the shared piece into a module both sides depend on, or by " +
      "inverting one of the two dependencies.",
    severity: "error",
    from: {},
    to: { circular: true, viaOnly: { dependencyTypesNot: ["type-only"] } },
  };
}

function targetPattern(
  architecture: ResolvedArchitecture,
  boundary: LayerBoundary,
): string {
  return `^${architecture.sourceRoot}/(${boundary.to.join("|")})/`;
}

function boundaryRule(
  architecture: ResolvedArchitecture,
  boundary: LayerBoundary,
  name: string,
  fromPattern: string,
): IRegularForbiddenRuleType {
  const to =
    boundary.allowTypeOnlyImports === true
      ? {
          path: targetPattern(architecture, boundary),
          dependencyTypesNot: ["type-only" as const],
        }
      : { path: targetPattern(architecture, boundary) };
  return {
    name,
    comment: boundary.comment,
    severity: "error",
    from: { path: fromPattern },
    to,
  };
}

/** The rules enforced against a package's real source tree. */
export function sourceRules(
  architecture: ResolvedArchitecture,
): IRegularForbiddenRuleType[] {
  return [
    circularRule(),
    ...architecture.boundaries.map((boundary) =>
      boundaryRule(
        architecture,
        boundary,
        boundary.name,
        `^${architecture.sourceRoot}/${boundary.from}/`,
      ),
    ),
  ];
}

/**
 * The same rules, re-pointed at the negative-fixture directory. Deriving them
 * rather than restating them is the whole point: a boundary can never be
 * proven by a fixture that has drifted away from the rule it is proving.
 *
 * A fixture for boundary `X` is any file named `<X.from>-<something>` directly
 * under the fixture root.
 */
export function fixtureRules(
  architecture: ResolvedArchitecture,
  fixtureRoot: string,
): IRegularForbiddenRuleType[] {
  return architecture.boundaries.map((boundary) =>
    boundaryRule(
      architecture,
      boundary,
      fixtureRuleName(boundary),
      `^${fixtureRoot}/${boundary.from}-`,
    ),
  );
}

function fixtureRuleName(boundary: LayerBoundary): string {
  return `${FIXTURE_RULE_PREFIX}${boundary.name}`;
}

/** Every fixture rule name a complete negative-fixture suite must trigger. */
export function expectedFixtureRuleNames(
  architecture: ResolvedArchitecture,
): string[] {
  return architecture.boundaries
    .map((boundary) => fixtureRuleName(boundary))
    .sort();
}

/** The file-name prefix a fixture proving `boundary` has to use. */
export function fixtureFilePrefix(boundary: LayerBoundary): string {
  return `${boundary.from}-`;
}
