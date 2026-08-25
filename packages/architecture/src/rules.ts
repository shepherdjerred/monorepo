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

/**
 * A layer is its directory *and* the module of the same name beside it.
 *
 * Scout-for-lol has both `src/configuration/` and `src/configuration.ts`, and
 * the root file is the bulk of the layer. Matching only `src/configuration/`
 * left it exempt, so the layer could import anything it liked through its own
 * front door and the rule still reported clean. `(?:/|\.)` covers the
 * directory and every `configuration.*` module without an extension list to
 * drift, and cannot bleed into a sibling: `^src/report(?:/|\.)` does not match
 * `report-lake.ts`, because the next character is a dash.
 */
const LAYER_BOUNDARY_SUFFIX = String.raw`(?:/|\.)`;

function layerAlternation(sourceRoot: string, layers: string[]): string {
  return `^${sourceRoot}/(${layers.join("|")})${LAYER_BOUNDARY_SUFFIX}`;
}

function layerPattern(sourceRoot: string, layer: string): string {
  return `^${sourceRoot}/${layer}${LAYER_BOUNDARY_SUFFIX}`;
}

function targetPattern(
  architecture: ResolvedArchitecture,
  boundary: LayerBoundary,
): string {
  return layerAlternation(architecture.sourceRoot, boundary.to);
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
        layerPattern(architecture.sourceRoot, boundary.from),
      ),
    ),
  ];
}

/**
 * The same rules, re-pointed at the negative-fixture directory. Deriving them
 * rather than restating them is the whole point: a boundary can never be
 * proven by a fixture that has drifted away from the rule it is proving.
 *
 * A fixture for boundary `X` is any file whose name starts with
 * {@link fixtureFilePrefix} directly under the fixture root.
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
      `^${fixtureRoot}/${fixtureFilePrefix(boundary)}`,
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

/**
 * The file-name prefix a fixture proving `boundary` has to use.
 *
 * Fixtures sit flat in one directory, so a nested layer path is flattened:
 * a boundary from `lib/amazon` is proven by `lib-amazon-<what-it-does>.ts`.
 * `resolveArchitecture` refuses a definition in which two distinct layers
 * would create overlapping prefixes.
 */
export function fixtureFilePrefix(boundary: LayerBoundary): string {
  return `${boundary.from.replaceAll("/", "-")}-`;
}
