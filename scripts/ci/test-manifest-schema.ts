import path from "node:path";
import { z } from "zod";

/**
 * A workspace may split its steps into named groups that separate Turbo tasks
 * run through `run-ci-test.ts --group <name>`, so each group gets its own cache
 * key and dependencies. Either every step of a workspace has a group or none
 * does.
 */
const group = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/u)
  .optional();

const StepSchema = z.discriminatedUnion("runner", [
  z
    .object({
      runner: z.literal("vitest"),
      name: z.string().min(1).optional(),
      group,
      runtime: z.enum(["bun", "node"]).optional(),
      runtimeReason: z.string().min(1).optional(),
      runtimeArgs: z.array(z.string()).optional(),
      args: z.array(z.string()).optional(),
    })
    .strict(),
  z
    .object({
      runner: z.literal("go"),
      name: z.string().min(1).optional(),
      group,
      args: z.array(z.string()),
    })
    .strict(),
  z
    .object({
      runner: z.literal("cargo"),
      name: z.string().min(1).optional(),
      group,
      args: z.array(z.string()),
    })
    .strict(),
  z
    .object({
      runner: z.literal("dotnet"),
      name: z.string().min(1).optional(),
      group,
      args: z.array(z.string()).min(1),
      coverageConfig: z.string().min(1).optional(),
      mstest: z
        .object({
          parallel: z.boolean(),
          timeoutMs: z.number().int().positive(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      runner: z.literal("gradle"),
      name: z.string().min(1).optional(),
      group,
      args: z.array(z.string()).min(1),
    })
    .strict(),
  z
    .object({
      runner: z.literal("command"),
      name: z.string().min(1),
      group,
      command: z.array(z.string()).min(1),
    })
    .strict(),
]);

const workspaceTestFields = {
  package: z.string().min(1),
  defaultEnv: z.record(z.string(), z.string()).optional(),
  coverageAlways: z.boolean().optional(),
  steps: z
    .array(StepSchema)
    .min(1)
    .refine(
      (steps) =>
        steps.every((step) => step.group === undefined) ||
        steps.every((step) => step.group !== undefined),
      "either every step of a workspace has a group or none does",
    ),
  // Suites this reporting workspace deliberately does NOT run, each with
  // a rationale. Full reporting is test-only: suites needing service
  // containers or spawned sibling processes run in their dedicated
  // lanes, not here. Recorded so the scope=full claim is honest and so
  // assertExcludedSuitesAreUncovered can prove a step never runs them.
  excludedSuites: z
    .array(
      z
        .object({
          path: z.string().min(1),
          reason: z.string().min(1),
        })
        .strict(),
    )
    .min(1)
    .optional(),
};

/**
 * Each workspace keeps its CI test steps in its own file, so editing one
 * workspace's steps changes only that workspace's test:ci hash.
 */
export const WORKSPACE_TESTS_FILE = "ci-tests.json";

/** `<workspace>/ci-tests.json`. */
export const WorkspaceTestsSchema = z
  .object({
    $schema: z.string().regex(/(?:^|\/)ci-tests\.schema\.json$/u),
    ...workspaceTestFields,
  })
  .strict();

/** `scripts/ci-test-manifest.json`: workspaces without CI test steps. */
export const RootTestManifestSchema = z
  .object({
    $schema: z.literal("./ci-test-manifest.schema.json"),
    version: z.literal(2),
    testlessWorkspaces: z.array(
      z
        .object({
          package: z.string().min(1),
          directory: z.string().min(1),
          reason: z.string().min(1),
        })
        .strict(),
    ),
    separateTests: z.array(
      z
        .object({
          package: z.string().min(1),
          directory: z.string().min(1),
          reason: z.string().min(1),
          localScripts: z
            .object({
              build: z.literal("build:local").optional(),
              test: z.literal("test:local"),
            })
            .strict()
            .optional(),
        })
        .strict(),
    ),
  })
  .strict();

/** The assembled manifest: the root file plus every workspace's steps. */
export const TestManifestSchema = RootTestManifestSchema.extend({
  workspaces: z.array(
    z.object({ ...workspaceTestFields, directory: z.string().min(1) }).strict(),
  ),
}).strict();

const RootPackageSchema = z
  .object({
    workspaces: z.union([
      z.array(z.string()),
      z.object({ packages: z.array(z.string()) }).loose(),
    ]),
  })
  .loose();

/** Workspace directories in root package.json order. */
export async function workspaceDirectories(
  repositoryRoot: string,
): Promise<string[]> {
  const root = RootPackageSchema.parse(
    await Bun.file(path.join(repositoryRoot, "package.json")).json(),
  );
  return Array.isArray(root.workspaces)
    ? root.workspaces
    : root.workspaces.packages;
}

/** The shared schema every `ci-tests.json` names, from the repository root. */
export const WORKSPACE_TESTS_SCHEMA = "scripts/ci-tests.schema.json";

/** The exact `$schema` a workspace's `ci-tests.json` must carry. */
export function workspaceTestsSchemaReference(directory: string): string {
  return path.posix.relative(directory, WORKSPACE_TESTS_SCHEMA);
}

const WorkspacePackageSchema = z.object({ name: z.string().min(1) }).loose();

export type WorkspaceTests = z.infer<typeof WorkspaceTestsSchema>;

/**
 * Read one workspace's `ci-tests.json`, or undefined when it has none. The
 * file must name the shared schema by its exact relative path, so editors
 * resolve it, and its `package` must be the workspace's package.json name,
 * so a copied or renamed entry cannot report under another package.
 */
export async function readWorkspaceTests(
  repositoryRoot: string,
  directory: string,
): Promise<WorkspaceTests | undefined> {
  const file = Bun.file(
    path.join(repositoryRoot, directory, WORKSPACE_TESTS_FILE),
  );
  if (!(await file.exists())) return undefined;
  const label = `${directory}/${WORKSPACE_TESTS_FILE}`;
  const tests = WorkspaceTestsSchema.parse(await file.json());
  const schema = workspaceTestsSchemaReference(directory);
  if (tests.$schema !== schema) {
    throw new Error(
      `${label} must set "$schema" to "${schema}", not "${tests.$schema}"`,
    );
  }
  const { name } = WorkspacePackageSchema.parse(
    await Bun.file(path.join(repositoryRoot, directory, "package.json")).json(),
  );
  if (tests.package !== name) {
    throw new Error(
      `${label} names package "${tests.package}", but ${directory}/package.json is "${name}"`,
    );
  }
  return tests;
}

/** The root manifest with every workspace's `ci-tests.json` steps. */
export async function loadTestManifest(
  repositoryRoot: string,
): Promise<TestManifest> {
  const root = RootTestManifestSchema.parse(
    await Bun.file(
      path.join(repositoryRoot, "scripts", "ci-test-manifest.json"),
    ).json(),
  );
  const workspaces: TestManifest["workspaces"] = [];
  for (const directory of await workspaceDirectories(repositoryRoot)) {
    const tests = await readWorkspaceTests(repositoryRoot, directory);
    if (tests === undefined) continue;
    const { $schema: _schema, ...entry } = tests;
    workspaces.push({ ...entry, directory });
  }
  return TestManifestSchema.parse({ ...root, workspaces });
}

export type TestManifest = z.infer<typeof TestManifestSchema>;
export type TestStep = z.infer<typeof StepSchema>;
