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

/**
 * A layer is a single directory directly under the source root. Restricting the
 * shape keeps the generated regular expressions literal — a layer name can
 * never smuggle regex syntax into a rule.
 */
const LAYER_SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

const RULE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

const LayerBoundarySchema = z.object({
  /** dependency-cruiser rule name. Appears verbatim in violation output. */
  name: z.string().regex(RULE_NAME),
  /** Why the boundary exists. dependency-cruiser prints it next to every violation. */
  comment: z.string().min(1),
  /** Layer directory the rule applies from, relative to the source root. */
  from: z.string().regex(LAYER_SEGMENT),
  /** Layer directories `from` may not depend on, relative to the source root. */
  to: z.array(z.string().regex(LAYER_SEGMENT)).min(1),
});

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
  })
  .superRefine((definition, context) => {
    const seenNames = new Set<string>();
    for (const boundary of definition.boundaries) {
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
      if (boundary.to.includes(boundary.from)) {
        context.addIssue({
          code: "custom",
          message: `boundary "${boundary.name}" forbids "${boundary.from}" from depending on itself`,
        });
      }
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

/** A definition with every default filled in and every invariant checked. */
export type ResolvedArchitecture = z.output<
  typeof ArchitectureDefinitionSchema
>;

export type LayerBoundary = z.output<typeof LayerBoundarySchema>;

export function resolveArchitecture(definition: unknown): ResolvedArchitecture {
  return ArchitectureDefinitionSchema.parse(definition);
}
