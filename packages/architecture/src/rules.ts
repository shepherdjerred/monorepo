import type { IRegularForbiddenRuleType } from "dependency-cruiser";
import {
  CIRCULAR_RULE_NAME,
  FIXTURE_RULE_PREFIX,
  type LayerBoundary,
  type ResolvedArchitecture,
} from "#src/definition.ts";

/**
 * Eager runtime import cycles only.
 *
 * `viaOnly` narrows the rule to cycles in which every edge is an eager import.
 * A cycle closed by an `await import()` inside a function body resolves at call
 * time, long after every module has finished initialising, so it cannot make
 * initialisation order significant. It is also the sanctioned way to break a
 * registry cycle: a module that is itself registered but needs to look up the
 * complete registry cannot import it eagerly, by construction, so flagging the
 * deferral would leave no way to comply.
 *
 * Type-only edges are deliberately *not* excluded. dependency-cruiser cannot
 * identify them in this repository — see the note in `cruise.ts` — so an
 * exclusion would be a rule that silently does nothing.
 */
function circularRule(): IRegularForbiddenRuleType {
  return {
    name: CIRCULAR_RULE_NAME,
    comment:
      "An eager runtime import cycle makes module initialisation order significant, which is a " +
      "latent crash. Break it by extracting the shared piece into a module both sides depend on, " +
      "by inverting one of the two dependencies, or — for a registry lookup that cannot be " +
      "resolved eagerly — by deferring one edge behind an await import().",
    severity: "error",
    from: {},
    to: {
      circular: true,
      viaOnly: { dependencyTypesNot: ["dynamic-import"] },
    },
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
  return {
    name,
    comment: boundary.comment,
    severity: "error",
    from: { path: fromPattern },
    to: { path: targetPattern(architecture, boundary) },
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
