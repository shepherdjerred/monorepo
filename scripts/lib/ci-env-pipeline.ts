import { z } from "zod";

import { commandScopes } from "./ci-env-command.ts";

export type SecretKeyRef = { secretName: string; key: string };

export type PipelineStep = {
  key: string;
  providedNames: Set<string>;
  explicitSecretRefs?: ReadonlyMap<string, SecretKeyRef>;
  scripts: string[];
};

const StepSchema = z
  .object({
    key: z.string().optional(),
    label: z.string().optional(),
    command: z.union([z.string(), z.array(z.string())]).optional(),
    env: z.record(z.string(), z.unknown()).optional(),
    plugins: z.array(z.unknown()).optional(),
  })
  .loose();

const ValueFromSchema = z
  .object({
    secretKeyRef: z.object({ name: z.string(), key: z.string() }).optional(),
  })
  .loose();
const ContainerEnvSchema = z.object({
  env: z
    .array(
      z
        .object({
          name: z.string(),
          value: z.string().optional(),
          valueFrom: ValueFromSchema.optional(),
        })
        .loose(),
    )
    .optional(),
});
const RecordSchema = z.record(z.string(), z.unknown());

/**
 * Every explicit `env` name reachable anywhere inside a step. The Kubernetes
 * plugin nests containers differently per anchor (`podSpec` vs
 * `podSpecPatch`), so this walks the whole subtree rather than a fixed path.
 */
function collectContainerEnv(
  node: unknown,
  names: Set<string>,
  explicitSecretRefs: Map<string, SecretKeyRef>,
): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectContainerEnv(item, names, explicitSecretRefs);
    }
    return;
  }
  const record = RecordSchema.safeParse(node);
  if (!record.success) return;
  const container = ContainerEnvSchema.safeParse(record.data);
  if (container.success) {
    for (const entry of container.data.env ?? []) {
      // An explicitly empty value is not a provision: requireEnv treats "" as
      // missing and throws, so counting it would pass the check on a step
      // whose script fails at runtime. A secretKeyRef is checked against its
      // declaring OnePasswordItem and hashed vault snapshot below; other
      // valueFrom sources (for example a pod fieldRef) do provide a value.
      if (entry.value !== undefined) {
        if (entry.value !== "") names.add(entry.name);
      } else if (entry.valueFrom?.secretKeyRef !== undefined) {
        explicitSecretRefs.set(entry.name, {
          secretName: entry.valueFrom.secretKeyRef.name,
          key: entry.valueFrom.secretKeyRef.key,
        });
      } else if (entry.valueFrom !== undefined) {
        names.add(entry.name);
      }
    }
  }
  for (const value of Object.values(record.data)) {
    collectContainerEnv(value, names, explicitSecretRefs);
  }
}

export function collectSteps(
  pipeline: unknown,
  globalEnvNames: readonly string[],
): PipelineStep[] {
  const document = z
    .object({
      env: z.record(z.string(), z.unknown()).optional(),
      steps: z.array(z.unknown()).optional(),
    })
    .loose()
    .parse(pipeline);
  const steps: PipelineStep[] = [];
  for (const [index, raw] of (document.steps ?? []).entries()) {
    const parsed = StepSchema.safeParse(raw);
    if (!parsed.success) continue;
    const step = parsed.data;
    const command =
      step.command === undefined
        ? ""
        : Array.isArray(step.command)
          ? step.command.join("\n")
          : step.command;
    if (command.trim() === "") continue;
    const stepNames = new Set<string>([
      ...globalEnvNames,
      // Same rule as container env: a step-level key set to an empty string
      // satisfies nothing, because requireEnv rejects "" as missing.
      ...Object.entries(step.env ?? {})
        .filter(([, value]) => value !== "")
        .map(([key]) => key),
    ]);
    const explicitSecretRefs = new Map<string, SecretKeyRef>();
    collectContainerEnv(step.plugins, stepNames, explicitSecretRefs);
    const key = step.key ?? step.label ?? `step[${String(index)}]`;
    // One entry per subshell scope: a name exported inside `( … )` reaches the
    // scripts in that block and no others.
    for (const scope of commandScopes(command)) {
      if (scope.scripts.length === 0) continue;
      steps.push({
        key,
        providedNames: new Set([...stepNames, ...scope.assigned]),
        explicitSecretRefs,
        scripts: [...new Set(scope.scripts)].toSorted(),
      });
    }
  }
  return steps;
}
