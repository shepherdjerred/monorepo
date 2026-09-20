import {
  GeneratedStepsSchema,
  type GeneratedStep,
} from "./ci-env-generated.ts";

/**
 * Read the generated CI graph from outside the generator.
 *
 * Tests that used to assert against `.buildkite/pipeline.yml` use this
 * instead: the graph is generated now, so the only way to check a lane's
 * shape from another package is to ask the generator for it.
 */
export async function readGeneratedSteps(
  repositoryRoot: string,
): Promise<GeneratedStep[]> {
  const child = Bun.spawn(
    ["bun", "packages/woodpecker-config-extension/src/dump-steps.ts"],
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
  return GeneratedStepsSchema.parse(JSON.parse(stdout));
}

/** One step by key, or undefined when the generator does not emit it. */
export function findGeneratedStep(
  steps: readonly GeneratedStep[],
  key: string,
): GeneratedStep | undefined {
  return steps.find((step) => step.key === key);
}
