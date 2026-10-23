import {
  GeneratedStepsSchema,
  type GeneratedStep,
} from "./ci-env-generated.ts";

/**
 * Every pipeline graph the generator can emit, as `dump-steps.ts` arguments.
 * The v2 catalog flag adds producer steps (OpenTofu and npm archives) that
 * must meet the same grant contract and admission budget before the window
 * turns it on.
 */
export const CHECKED_STEP_GRAPHS: readonly (readonly string[])[] = [
  [],
  ["--delivery-catalog-v2"],
];

/**
 * Read the generated CI graph from outside the generator.
 *
 * The graph is generated rather than committed, so the only way to check a
 * lane's shape from another package is to ask the generator for it.
 */
export async function readGeneratedSteps(
  repositoryRoot: string,
): Promise<GeneratedStep[]> {
  return GeneratedStepsSchema.parse(
    await readGeneratedStepJson(repositoryRoot),
  );
}

/**
 * The generator's complete step model as untyped JSON, for a checker that
 * needs fields the credential contract does not (resources, services).
 */
export async function readGeneratedStepJson(
  repositoryRoot: string,
  options: { includeCanaries?: boolean; graph?: readonly string[] } = {},
): Promise<unknown> {
  const child = Bun.spawn(
    [
      "bun",
      "packages/woodpecker-config-extension/src/dump-steps.ts",
      ...(options.includeCanaries === true ? ["--include-canaries"] : []),
      ...(options.graph ?? []),
    ],
    { cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `could not read the generated step model: ${stderr.trim()}`,
    );
  }
  const parsed: unknown = JSON.parse(stdout);
  return parsed;
}

/** One step by key, or undefined when the generator does not emit it. */
export function findGeneratedStep(
  steps: readonly GeneratedStep[],
  key: string,
): GeneratedStep | undefined {
  return steps.find((step) => step.key === key);
}
