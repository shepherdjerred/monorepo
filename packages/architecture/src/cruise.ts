import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { cruise, type ICruiseOptions } from "dependency-cruiser";
import {
  DEFAULT_FIXTURE_ROOT,
  type ResolvedArchitecture,
  resolveArchitecture,
} from "#src/definition.ts";
import { parseCruiseReport, renderViolations } from "#src/cruise-result.ts";
import { fixtureFilePrefix, fixtureRules, sourceRules } from "#src/rules.ts";

/**
 * Boundaries apply to every edge kind, including `import type`.
 *
 * That is not a stylistic choice, it is the only honest option here.
 * dependency-cruiser only tags an edge `type-only` from its TypeScript
 * extractor, which it enables by resolving `typescript` in the range
 * `>=2.0.0 <7.0.0` through a `createRequire` anchored in its own directory.
 * Under Bun's isolated linker that lands on the flat fallback at
 * `node_modules/.bun/node_modules/typescript`, and this repository declares
 * `@typescript/native: npm:typescript@7.0.2` in a dozen or more packages — so
 * the version that wins is out of range, the extractor is silently skipped,
 * and every `import type` arrives as a plain `["local", "import"]`.
 *
 * Which version wins that flat fallback is not something a rule set should
 * depend on: it differs between a long-lived worktree and a fresh CI install,
 * so a `dependencyTypesNot: ["type-only"]` exemption would pass locally and do
 * nothing in CI. Rather than encode a knob that lies, boundaries hold for all
 * edge kinds, and a type shared across a boundary belongs in a shared module.
 *
 * `tsPreCompilationDeps` is deliberately absent for the same reason: with the
 * extractor skipped it changes nothing in any of its three settings.
 *
 * `exportsFields`/`conditionNames` are what let enhanced-resolve follow the
 * `#subpath/*` imports several packages here declare.
 */
function baseOptions(
  packageRoot: string,
  architecture: ResolvedArchitecture,
  roots: readonly string[],
) {
  return {
    validate: true,
    baseDir: packageRoot,
    outputType: "json",
    doNotFollow: { path: "node_modules" },
    // Scope every rule to the package's own tree. With the isolated linker a
    // `workspace:*` dependency resolves through a symlink to a sibling source
    // directory, so without this a package inherits — and is failed by — its
    // dependencies' cycles, which their own checks already own.
    includeOnly: { path: `^(${roots.join("|")})/` },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "types", "default"],
    },
    tsConfig: {
      fileName: path.join(packageRoot, architecture.tsConfigFileName),
    },
  } satisfies ICruiseOptions;
}

/**
 * Existence check with a message that names what was missing. `stat` failing is
 * the fail-fast signal; the wrapper only adds which of the two roots it was.
 */
async function requireDirectory(
  directory: string,
  label: string,
): Promise<void> {
  const info = await stat(directory).catch((error: unknown) => {
    throw new Error(`${label} does not exist: ${directory}`, { cause: error });
  });
  if (!info.isDirectory()) {
    throw new Error(`${label} is not a directory: ${directory}`);
  }
}

export type ArchitectureCheckResult = {
  /** Modules dependency-cruiser actually looked at. Zero means the check was vacuous. */
  modulesCruised: number;
  /** Number of `severity: "error"` violations. */
  errorCount: number;
  /** Human-readable report, empty when the cruise was clean. */
  report: string;
};

/**
 * Enforce a package's architecture against its real source tree.
 *
 * Throws — rather than passing — when the cruise found no modules. A rule set
 * that silently inspects nothing is worse than no rule set at all, because it
 * reads as a green check.
 */
export async function checkArchitecture(options: {
  packageRoot: string;
  definition: unknown;
}): Promise<ArchitectureCheckResult> {
  const architecture = resolveArchitecture(options.definition);
  const sourceDirectory = path.join(
    options.packageRoot,
    architecture.sourceRoot,
  );
  await requireDirectory(sourceDirectory, "source root");

  const rules = sourceRules(architecture);
  const cruised = await cruise([architecture.sourceRoot], {
    ...baseOptions(options.packageRoot, architecture, [
      architecture.sourceRoot,
    ]),
    ruleSet: { forbidden: rules },
  });
  const report = parseCruiseReport(cruised.output);
  if (report.summary.totalCruised === 0) {
    throw new Error(
      `dependency-cruiser found no modules under ${sourceDirectory}; the architecture check would pass vacuously`,
    );
  }

  return {
    modulesCruised: report.summary.totalCruised,
    errorCount: report.summary.error,
    report: renderViolations(report.summary.violations, rules),
  };
}

export type FixtureCruiseResult = {
  /** Fixture files that were cruised, relative to the fixture root. */
  fixtureFiles: string[];
  /** Number of `severity: "error"` violations the fixtures provoked. */
  errorCount: number;
  /** Unique, sorted names of the fixture rules that fired. */
  violatedRuleNames: string[];
};

/**
 * Run the *derived* fixture rules against the committed negative fixtures.
 *
 * This is the non-vacuity proof: it demonstrates that each boundary rule can
 * actually fail. Because the rules are derived from the same boundary list the
 * real check uses, a fixture cannot drift out of sync with the rule it proves.
 */
export async function cruiseArchitectureFixtures(options: {
  packageRoot: string;
  definition: unknown;
  fixtureRoot?: string;
}): Promise<FixtureCruiseResult> {
  const architecture = resolveArchitecture(options.definition);
  const fixtureRoot = options.fixtureRoot ?? DEFAULT_FIXTURE_ROOT;
  const fixtureDirectory = path.join(options.packageRoot, fixtureRoot);
  await requireDirectory(fixtureDirectory, "fixture root");
  if (architecture.boundaries.length === 0) {
    throw new Error(
      "cruiseArchitectureFixtures was called for a package that declares no layer boundaries",
    );
  }

  const entries = await readdir(fixtureDirectory);
  const fixtureFiles = entries
    .filter((entry) => entry.endsWith(".ts") || entry.endsWith(".tsx"))
    .sort();
  if (fixtureFiles.length === 0) {
    throw new Error(`no negative fixtures found in ${fixtureDirectory}`);
  }

  for (const boundary of architecture.boundaries) {
    const prefix = fixtureFilePrefix(boundary);
    if (!fixtureFiles.some((file) => file.startsWith(prefix))) {
      throw new Error(
        `boundary "${boundary.name}" has no negative fixture; add ${fixtureRoot}/${prefix}<what-it-does>.ts`,
      );
    }
  }
  const prefixes = architecture.boundaries.map((boundary) =>
    fixtureFilePrefix(boundary),
  );
  for (const file of fixtureFiles) {
    if (!prefixes.some((prefix) => file.startsWith(prefix))) {
      throw new Error(
        `fixture ${fixtureRoot}/${file} does not match any boundary; expected a name starting with one of ${prefixes.join(", ")}`,
      );
    }
  }

  const cruised = await cruise(
    fixtureFiles.map((file) => `${fixtureRoot}/${file}`),
    {
      ...baseOptions(options.packageRoot, architecture, [
        architecture.sourceRoot,
        fixtureRoot,
      ]),
      ruleSet: { forbidden: fixtureRules(architecture, fixtureRoot) },
    },
  );
  const report = parseCruiseReport(cruised.output);
  const violatedRuleNames = [
    ...new Set(
      report.summary.violations.map((violation) => violation.rule.name),
    ),
  ].sort();
  return {
    fixtureFiles,
    errorCount: report.summary.error,
    violatedRuleNames,
  };
}
