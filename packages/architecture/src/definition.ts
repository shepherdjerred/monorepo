import { z } from "zod";

/**
 * The one rule every package gets for free. Named here so a package cannot
 * accidentally shadow it with a boundary of the same name.
 */
export const CIRCULAR_RULE_NAME = "no-circular";

/**
 * Prefix applied to the negative-fixture variant of a boundary rule, so a
 * fixture violation is never confused with a real source violation.
 */
export const FIXTURE_RULE_PREFIX = "negative-";

/** Default directory holding the deliberate violations that prove the rules bite. */
export const DEFAULT_FIXTURE_ROOT = "architecture-fixtures";

const SEGMENT = "[a-z0-9]+(?:-[a-z0-9]+)*";

/**
 * A layer is a directory under the source root, named as one or more kebab-case
 * segments. Nesting is permitted because not every package puts its layers
 * directly under `src/`: monarch's vendor adapters live in `src/lib/`, and
 * narrowing its source root to match would take `src/index.ts` out of the
 * cycle check. Restricting the shape to literal segments keeps the generated
 * regular expressions literal — a layer path can never smuggle regex syntax
 * into a rule.
 */
const LAYER_PATH = new RegExp(`^${SEGMENT}(?:/${SEGMENT})*$`, "u");

const RULE_NAME = new RegExp(`^${SEGMENT}$`, "u");

const LayerBoundarySchema = z.object({
  /** dependency-cruiser rule name. Appears verbatim in violation output. */
  name: z.string().regex(RULE_NAME),
  /** Why the boundary exists. dependency-cruiser prints it next to every violation. */
  comment: z.string().min(1),
  /** Layer directory the rule applies from, relative to the source root. */
  from: z.string().regex(LAYER_PATH),
  /** Layer directories `from` may not depend on, relative to the source root. */
  to: z.array(z.string().regex(LAYER_PATH)).min(1),
});

/**
 * A set of sibling layers, none of which may depend on another — a horizontal
 * rule rather than a vertical one. Monarch's per-vendor statement parsers are
 * the motivating case: there is no ordering among them, only the requirement
 * that each stays self-contained.
 *
 * It expands to one ordinary boundary per member, which is the point. Writing
 * the same N×(N−1) matrix by hand states one architectural idea as N unrelated
 * rules, and nothing then keeps the matrix symmetric when a member is added.
 */
const IsolatedGroupSchema = z.object({
  /**
   * Prefix for the generated rule names. Each member yields
   * `<name>-<member with slashes replaced by dashes>`.
   */
  name: z.string().regex(RULE_NAME),
  /** Why the members must stay independent. Applied to every generated rule. */
  comment: z.string().min(1),
  /** The mutually independent layers, relative to the source root. */
  layers: z.array(z.string().regex(LAYER_PATH)).min(2),
});

type IsolatedGroup = z.output<typeof IsolatedGroupSchema>;

/**
 * Whether `ancestor` contains `descendant` in the directory tree, counting a
 * layer as containing itself.
 *
 * A layer path becomes an anchored directory pattern, so containment is not a
 * stylistic concern: `^src/lib/` matches every file under `src/lib/amazon/`
 * too. Two layers in a containment relationship cannot both be treated as
 * distinct regions of the tree.
 */
function contains(ancestor: string, descendant: string): boolean {
  return descendant === ancestor || descendant.startsWith(`${ancestor}/`);
}

/** Rule and fixture names are flat, so a nested layer path is flattened. */
function flattenLayerPath(layer: string): string {
  return layer.replaceAll("/", "-");
}

function expandIsolatedGroup(group: IsolatedGroup): LayerBoundary[] {
  return group.layers.map((layer) => ({
    name: `${group.name}-${flattenLayerPath(layer)}`,
    comment: group.comment,
    from: layer,
    to: group.layers.filter((other) => other !== layer),
  }));
}

type IssueSink = {
  addIssue: (issue: { code: "custom"; message: string }) => void;
};

/**
 * A boundary's targets have to be regions distinct from its source, and from
 * each other.
 *
 * This is stricter than `to.includes(from)` because layer paths nest. A
 * boundary from `lib/amazon` targeting `lib` generates `to: ^src/(lib)/`,
 * which every import *inside* `src/lib/amazon/` matches — ordinary same-layer
 * imports would be reported as cross-layer violations, and the reverse
 * direction makes the rule claim the descendant's files as its own sources.
 * Targeting both a layer and its descendant is merely redundant, but it reads
 * as though the narrower one adds something, so it is refused too.
 */
function checkTargets(boundary: LayerBoundary, sink: IssueSink): void {
  for (const target of boundary.to) {
    if (contains(target, boundary.from) || contains(boundary.from, target)) {
      sink.addIssue({
        code: "custom",
        message: `boundary "${boundary.name}" forbids "${boundary.from}" from depending on "${target}", which is the same layer or contains it`,
      });
    }
    for (const other of boundary.to) {
      if (target !== other && contains(target, other)) {
        sink.addIssue({
          code: "custom",
          message: `boundary "${boundary.name}" targets both "${target}" and its descendant "${other}"; the wider target already covers it`,
        });
      }
    }
  }
}

const ArchitectureDefinitionSchema = z
  .object({
    /** Directory the cruise starts from, relative to the package root. */
    sourceRoot: z.string().min(1).default("src"),
    /** tsconfig used to resolve and transpile, relative to the package root. */
    tsConfigFileName: z.string().min(1).default("tsconfig.json"),
    /**
     * Layer boundaries. `no-circular` is always enforced and is deliberately
     * not expressible here.
     */
    boundaries: z.array(LayerBoundarySchema).default([]),
    /** Mutual-independence groups, expanded into ordinary boundaries. */
    isolatedGroups: z.array(IsolatedGroupSchema).default([]),
  })
  .superRefine((definition, context) => {
    const seenNames = new Set<string>();
    const seenFixturePrefixes = new Map<string, string>();
    for (const group of definition.isolatedGroups) {
      if (new Set(group.layers).size !== group.layers.length) {
        context.addIssue({
          code: "custom",
          message: `isolated group "${group.name}" repeats a layer`,
        });
      }
      for (const layer of group.layers) {
        for (const other of group.layers) {
          if (layer !== other && contains(layer, other)) {
            context.addIssue({
              code: "custom",
              message: `isolated group "${group.name}" contains "${layer}" and its descendant "${other}"; a group's members have to be disjoint regions of the tree`,
            });
          }
        }
      }
    }
    for (const boundary of expandBoundaries(definition)) {
      const prefix = flattenLayerPath(boundary.from);
      const collision = seenFixturePrefixes.get(prefix);
      if (collision !== undefined && collision !== boundary.from) {
        context.addIssue({
          code: "custom",
          message: `layers "${collision}" and "${boundary.from}" flatten to the same fixture prefix "${prefix}"`,
        });
      }
      seenFixturePrefixes.set(prefix, boundary.from);
      if (boundary.name === CIRCULAR_RULE_NAME) {
        context.addIssue({
          code: "custom",
          message: `"${CIRCULAR_RULE_NAME}" is always enforced and cannot be redefined as a boundary`,
        });
      }
      if (seenNames.has(boundary.name)) {
        context.addIssue({
          code: "custom",
          message: `duplicate boundary name "${boundary.name}"`,
        });
      }
      seenNames.add(boundary.name);
      checkTargets(boundary, context);
      if (new Set(boundary.to).size !== boundary.to.length) {
        context.addIssue({
          code: "custom",
          message: `boundary "${boundary.name}" repeats a target layer`,
        });
      }
    }
  });

/** What a package writes in `architecture.config.ts`. */
export type ArchitectureDefinition = z.input<
  typeof ArchitectureDefinitionSchema
>;

export type LayerBoundary = z.output<typeof LayerBoundarySchema>;

/**
 * A definition with every default filled in, every isolated group expanded,
 * and every invariant checked. Groups are gone by this point on purpose:
 * everything downstream — rule generation, fixture derivation, the coverage
 * guard — sees one flat boundary list and needs to know nothing about how a
 * boundary was declared.
 */
export type ResolvedArchitecture = {
  sourceRoot: string;
  tsConfigFileName: string;
  boundaries: LayerBoundary[];
};

function expandBoundaries(definition: {
  boundaries: LayerBoundary[];
  isolatedGroups: IsolatedGroup[];
}): LayerBoundary[] {
  return [
    ...definition.boundaries,
    ...definition.isolatedGroups.flatMap((group) => expandIsolatedGroup(group)),
  ];
}

export function resolveArchitecture(definition: unknown): ResolvedArchitecture {
  const parsed = ArchitectureDefinitionSchema.parse(definition);
  return {
    sourceRoot: parsed.sourceRoot,
    tsConfigFileName: parsed.tsConfigFileName,
    boundaries: expandBoundaries(parsed),
  };
}
