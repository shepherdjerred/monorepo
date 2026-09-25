import { z } from "zod";
import { commandScopes } from "./ci-env-command.ts";
import type { PipelineStep, SecretKeyRef } from "./ci-env-pipeline.ts";

/**
 * Read the CI graph from the generator rather than from committed YAML.
 *
 * The credential contract used to be checked against `.buildkite/pipeline.yml`
 * plus a `secret-grants.json` manifest that restated every grant. The graph is
 * generated now, so the grants in the step model ARE the manifest -- there is
 * no second copy to drift from, and the comparison that used to guard against
 * that drift is gone with it.
 *
 * What the checker still proves is the part that matters: every environment
 * variable a step's scripts require is actually granted to that step.
 */

const GeneratedStepSchema = z.object({
  key: z.string(),
  commands: z.array(z.string()),
  timeoutMinutes: z.number().optional(),
  dependsOn: z.array(z.string()).optional(),
  environment: z.record(z.string(), z.string()).optional(),
  secrets: z
    .array(z.object({ secret: z.string(), key: z.string(), env: z.string() }))
    .optional(),
});

export const GeneratedStepsSchema = z.array(GeneratedStepSchema);

export type GeneratedStep = z.infer<typeof GeneratedStepSchema>;

/**
 * Map generated steps onto the shape the requirement analysis expects.
 *
 * `providedNames` is what the step can read: its plain environment plus every
 * granted variable. Anything a reachable `requireEnv` asks for that is not in
 * that set is a contract violation.
 */
export function generatedPipelineSteps(
  steps: readonly GeneratedStep[],
): PipelineStep[] {
  const out: PipelineStep[] = [];
  for (const step of steps) {
    const grants = step.secrets ?? [];
    // A step-level variable set to an empty string satisfies nothing, because
    // requireEnv rejects "" as missing -- same rule the YAML reader applied.
    const stepNames = new Set<string>([
      ...Object.entries(step.environment ?? {})
        .filter(([, value]) => value !== "")
        .map(([key]) => key),
      ...grants.map((grant) => grant.env),
    ]);
    const explicitSecretRefs = new Map<string, SecretKeyRef>(
      grants.map((grant) => [
        grant.env,
        { secretName: grant.secret, key: grant.key },
      ]),
    );
    // One entry per subshell scope: a name exported inside `( … )` reaches the
    // scripts in that block and no others.
    for (const scope of commandScopes(step.commands.join("\n"))) {
      if (scope.scripts.length === 0) continue;
      out.push({
        key: step.key,
        providedNames: new Set([...stepNames, ...scope.assigned]),
        explicitSecretRefs,
        scripts: [...new Set(scope.scripts)].toSorted(),
      });
    }
  }
  return out;
}
