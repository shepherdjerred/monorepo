/**
 * Validates and loads CI test configuration.
 *
 * Each reporting workspace declares its steps in its own `ci-test.json`, so a
 * workspace's `test:ci` Turbo hash depends only on that file. The central
 * scripts/ci-test-manifest.json lists the testless and separately tested
 * workspaces. Workspace discovery uses the root package.json `workspaces`
 * list, which Turbo always hashes.
 *
 * run-ci-test.ts reads only its own workspace's file through
 * readWorkspaceTestConfig. Repository-wide checks and report indexes use
 * loadTestManifest, which reads every workspace's file.
 */
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

/**
 * A reporting workspace's own CI test configuration, committed beside its
 * package.json as `ci-test.json`. It lives in the workspace so the workspace's
 * `test:ci` Turbo hash covers only its own configuration. The package name and
 * directory come from the workspace itself, so the file does not repeat them.
 */
export const WorkspaceTestConfigSchema = z
  .object({
    // The relative path from the workspace to scripts/ci-test.schema.json;
    // the loader checks the exact value so editors always resolve the schema.
    $schema: z.string().min(1),
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
  })
  .strict();

/**
 * The central manifest, scripts/ci-test-manifest.json: the workspaces that do
 * not report through run-ci-test.ts, each with its reason. Reporting
 * workspaces are declared by their own `ci-test.json` instead.
 */
export const TestManifestSchema = z
  .object({
    $schema: z.literal("./ci-test-manifest.schema.json"),
    version: z.literal(3),
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

export type WorkspaceTestConfig = z.infer<typeof WorkspaceTestConfigSchema>;
export type CentralTestManifest = z.infer<typeof TestManifestSchema>;
/** A reporting workspace: its `ci-test.json` plus its package identity. */
export type ReportingWorkspace = Omit<WorkspaceTestConfig, "$schema"> & {
  package: string;
  directory: string;
};
/** Every workspace's CI test classification, assembled by loadTestManifest. */
export type TestManifest = {
  workspaces: ReportingWorkspace[];
  testlessWorkspaces: CentralTestManifest["testlessWorkspaces"];
  separateTests: CentralTestManifest["separateTests"];
};
export type TestStep = z.infer<typeof StepSchema>;

export const WORKSPACE_TEST_CONFIG_FILE = "ci-test.json";
export const WORKSPACE_TEST_CONFIG_SCHEMA = "scripts/ci-test.schema.json";
export const CENTRAL_TEST_MANIFEST = "scripts/ci-test-manifest.json";

const RootPackageSchema = z.object({
  workspaces: z.array(z.string().min(1)),
});
const WorkspacePackageSchema = z.object({ name: z.string().min(1) });

/** The `$schema` value a workspace's `ci-test.json` must carry. */
export function workspaceTestConfigSchemaReference(directory: string): string {
  const relative = path.posix.relative(directory, WORKSPACE_TEST_CONFIG_SCHEMA);
  return relative.startsWith(".") ? relative : `./${relative}`;
}

/** Workspace directories from the root package.json, in declaration order. */
export async function workspaceDirectories(
  repositoryRoot: string,
): Promise<string[]> {
  return RootPackageSchema.parse(
    await Bun.file(path.join(repositoryRoot, "package.json")).json(),
  ).workspaces;
}

/** Workspace directories nested under `directory`, relative to it. */
export function workspacesNestedUnder(
  directory: string,
  workspaces: readonly string[],
): string[] {
  return workspaces
    .filter((workspace) => workspace.startsWith(`${directory}/`))
    .map((workspace) => workspace.slice(directory.length + 1));
}

/**
 * Read one workspace's `ci-test.json`, or undefined when the workspace does not
 * report through run-ci-test.ts. Reads nothing outside the workspace.
 */
export async function readWorkspaceTestConfig(
  repositoryRoot: string,
  directory: string,
): Promise<ReportingWorkspace | undefined> {
  const configPath = path.join(
    repositoryRoot,
    directory,
    WORKSPACE_TEST_CONFIG_FILE,
  );
  const file = Bun.file(configPath);
  if (!(await file.exists())) return undefined;
  const displayPath = `${directory}/${WORKSPACE_TEST_CONFIG_FILE}`;
  const parsed = WorkspaceTestConfigSchema.safeParse(await file.json());
  if (!parsed.success) {
    throw new Error(`${displayPath} is invalid: ${parsed.error.message}`);
  }
  const { $schema, ...config } = parsed.data;
  const expectedSchema = workspaceTestConfigSchemaReference(directory);
  if ($schema !== expectedSchema) {
    throw new Error(
      `${displayPath} must set "$schema" to "${expectedSchema}", not "${$schema}"`,
    );
  }
  const packageJson = WorkspacePackageSchema.parse(
    await Bun.file(path.join(repositoryRoot, directory, "package.json")).json(),
  );
  return { package: packageJson.name, directory, ...config };
}

/** Read the central manifest of testless and separately tested workspaces. */
export async function readCentralTestManifest(
  repositoryRoot: string,
): Promise<CentralTestManifest> {
  return TestManifestSchema.parse(
    await Bun.file(path.join(repositoryRoot, CENTRAL_TEST_MANIFEST)).json(),
  );
}

/** Assemble every workspace's CI test classification. */
export async function loadTestManifest(
  repositoryRoot: string,
): Promise<TestManifest> {
  const central = await readCentralTestManifest(repositoryRoot);
  const nonReporting = new Set(
    [...central.testlessWorkspaces, ...central.separateTests].map(
      (entry) => entry.directory,
    ),
  );
  const workspaces: ReportingWorkspace[] = [];
  for (const directory of await workspaceDirectories(repositoryRoot)) {
    const workspace = await readWorkspaceTestConfig(repositoryRoot, directory);
    if (workspace === undefined) continue;
    if (nonReporting.has(directory)) {
      throw new Error(
        `${directory}/${WORKSPACE_TEST_CONFIG_FILE} exists, but ${CENTRAL_TEST_MANIFEST} also lists ${directory} as testless or separately tested`,
      );
    }
    workspaces.push(workspace);
  }
  return {
    workspaces,
    testlessWorkspaces: central.testlessWorkspaces,
    separateTests: central.separateTests,
  };
}
