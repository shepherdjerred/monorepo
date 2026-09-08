import { z } from "zod";
import { commandScopes } from "./ci-env-command.ts";
import type { SecretGrant } from "./ci-secret-grant-schema.ts";

const EXPECTED_SERVICE_ACCOUNT = "buildkite-job";
const TEST_COLLECTOR_GRANT: SecretGrant = {
  env: "BUILDKITE_ANALYTICS_TOKEN",
  secret: "buildkite-analytics-credentials",
  key: "BUILDKITE_ANALYTICS_TOKEN",
};
const NonBlankString = z.string().trim().min(1);
const RecordSchema = z.record(z.string(), z.unknown());
const StepSchema = z
  .object({
    key: NonBlankString,
    command: z.union([z.string(), z.array(z.string())]),
    env: z.record(z.string(), z.unknown()).optional(),
    plugins: z.array(z.unknown()),
  })
  .loose();
const EnvEntrySchema = z
  .object({
    name: z.string(),
    value: z.string().optional(),
    valueFrom: z.unknown().optional(),
  })
  .loose();
const ContainerSchema = z
  .object({
    name: z.string().optional(),
    env: z.array(EnvEntrySchema).optional(),
    envFrom: z.array(z.unknown()).optional(),
  })
  .loose();
const PodSpecSchema = z
  .object({
    serviceAccountName: z.string().optional(),
    automountServiceAccountToken: z.boolean().optional(),
    containers: z.array(z.unknown()).optional(),
    initContainers: z.array(z.unknown()).optional(),
    ephemeralContainers: z.array(z.unknown()).optional(),
    volumes: z.array(z.unknown()).optional(),
  })
  .loose();
const SecretKeyRefSchema = z
  .object({
    name: z.string(),
    key: z.string(),
    optional: z.boolean().optional(),
  })
  .loose();

function commandText(command: string | string[]): string {
  return Array.isArray(command) ? command.join("\n") : command;
}

function grantIdentity(grant: SecretGrant): string {
  return `${grant.env}\u{0000}${grant.secret}\u{0000}${grant.key}`;
}

function displayGrant(grant: SecretGrant): string {
  return `${grant.env} <- ${grant.secret}/${grant.key}`;
}

function kubernetesPodSpec(plugins: readonly unknown[]): {
  podSpec: unknown;
  errors: string[];
} {
  const candidates: unknown[] = [];
  for (const plugin of plugins) {
    const record = RecordSchema.safeParse(plugin);
    if (!record.success) continue;
    const kubernetes = RecordSchema.safeParse(record.data["kubernetes"]);
    if (!kubernetes.success) continue;
    candidates.push(
      kubernetes.data["podSpecPatch"] ?? kubernetes.data["podSpec"],
    );
  }
  if (candidates.length === 1 && candidates[0] !== undefined) {
    return { podSpec: candidates[0], errors: [] };
  }
  return {
    podSpec: undefined,
    errors: [
      `expected one Kubernetes plugin podSpecPatch, found ${String(candidates.length)}`,
    ],
  };
}

function usesTestCollector(plugins: readonly unknown[]): boolean {
  return plugins.some((plugin) => {
    const record = RecordSchema.safeParse(plugin);
    return (
      record.success &&
      Object.keys(record.data).some((key) => key.startsWith("test-collector#"))
    );
  });
}

function secretKeyRefFrom(entry: z.infer<typeof EnvEntrySchema>): unknown {
  const valueFrom = RecordSchema.safeParse(entry.valueFrom);
  if (!valueFrom.success) return undefined;
  return valueFrom.data["secretKeyRef"];
}

type ContainerAudit = {
  grants: SecretGrant[];
  errors: string[];
  providedNames: Set<string>;
};

function auditContainer(
  raw: unknown,
  location: string,
  allowSecretGrants: boolean,
): ContainerAudit {
  const parsed = ContainerSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      grants: [],
      errors: [`${location} is not a valid container`],
      providedNames: new Set(),
    };
  }
  const errors: string[] = [];
  const grants: SecretGrant[] = [];
  const providedNames = new Set<string>();
  if (parsed.data.envFrom !== undefined) {
    errors.push(`${location} declares envFrom`);
  }
  for (const [index, entry] of (parsed.data.env ?? []).entries()) {
    if (entry.name.trim() === "") {
      errors.push(`${location}.env[${String(index)}] has a blank name`);
      continue;
    }
    if (entry.value !== "") providedNames.add(entry.name);
    const rawSecretKeyRef = secretKeyRefFrom(entry);
    if (rawSecretKeyRef === undefined) continue;
    const secretKeyRef = SecretKeyRefSchema.safeParse(rawSecretKeyRef);
    if (!secretKeyRef.success) {
      errors.push(
        `${location}.env[${String(index)}] has an invalid secretKeyRef`,
      );
      continue;
    }
    if (!allowSecretGrants) {
      errors.push(
        `${location} receives secret environment variable ${entry.name}`,
      );
    }
    if (secretKeyRef.data.optional !== undefined) {
      errors.push(
        `${location}.env[${String(index)}] declares optional on a secretKeyRef`,
      );
    }
    if (
      secretKeyRef.data.name.trim() === "" ||
      secretKeyRef.data.key.trim() === ""
    ) {
      errors.push(
        `${location}.env[${String(index)}] has a blank secret grant field`,
      );
      continue;
    }
    grants.push({
      env: entry.name,
      secret: secretKeyRef.data.name,
      key: secretKeyRef.data.key,
    });
  }
  return { grants, errors, providedNames };
}

function hasSecretVolume(raw: unknown): boolean {
  const volume = RecordSchema.safeParse(raw);
  if (!volume.success) return false;
  if (volume.data["secret"] !== undefined) return true;
  const projected = RecordSchema.safeParse(volume.data["projected"]);
  if (!projected.success) return false;
  const sources = projected.data["sources"];
  if (!Array.isArray(sources)) return false;
  return sources.some((source) => {
    const parsedSource = RecordSchema.safeParse(source);
    return parsedSource.success && parsedSource.data["secret"] !== undefined;
  });
}

type PodContainerAudit = ContainerAudit & { commandContainerCount: number };

function auditPodContainers(
  pod: z.infer<typeof PodSpecSchema>,
  key: string,
): PodContainerAudit {
  const result: PodContainerAudit = {
    grants: [],
    errors: [],
    providedNames: new Set(),
    commandContainerCount: 0,
  };
  for (const [index, container] of (pod.containers ?? []).entries()) {
    const parsed = ContainerSchema.safeParse(container);
    const name = parsed.success
      ? (parsed.data.name ?? `containers[${String(index)}]`)
      : `containers[${String(index)}]`;
    const isCommand = name === "container-0";
    if (isCommand) result.commandContainerCount += 1;
    const audit = auditContainer(
      container,
      `step "${key}" container "${name}"`,
      isCommand,
    );
    result.errors.push(...audit.errors);
    if (!isCommand) continue;
    result.grants.push(...audit.grants);
    for (const provided of audit.providedNames) {
      result.providedNames.add(provided);
    }
  }
  for (const [kind, containers] of [
    ["initContainer", pod.initContainers ?? []],
    ["ephemeralContainer", pod.ephemeralContainers ?? []],
  ] as const) {
    for (const [index, container] of containers.entries()) {
      const audit = auditContainer(
        container,
        `step "${key}" ${kind}[${String(index)}]`,
        false,
      );
      result.errors.push(...audit.errors);
    }
  }
  return result;
}

export type PipelineStep = {
  key: string;
  command: string;
  providedNames: Set<string>;
  grants: SecretGrant[];
  scripts: string[];
  invocations: { entry: string; providedNames: Set<string> }[];
};

function collectStep(
  rawStep: unknown,
  globalEnvNames: readonly string[],
): { step?: PipelineStep; errors: string[] } {
  const parsedStep = StepSchema.safeParse(rawStep);
  if (!parsedStep.success) return { errors: [] };
  const { key } = parsedStep.data;
  const command = commandText(parsedStep.data.command);
  const plugin = kubernetesPodSpec(parsedStep.data.plugins);
  const errors = plugin.errors.map((error) => `step "${key}": ${error}`);
  const parsedPod = PodSpecSchema.safeParse(plugin.podSpec);
  if (!parsedPod.success) {
    return {
      errors: [...errors, `step "${key}": invalid Kubernetes podSpecPatch`],
    };
  }
  const pod = parsedPod.data;
  if (pod.serviceAccountName !== EXPECTED_SERVICE_ACCOUNT) {
    errors.push(
      `step "${key}": serviceAccountName must be ${EXPECTED_SERVICE_ACCOUNT}`,
    );
  }
  if (pod.automountServiceAccountToken !== false) {
    errors.push(`step "${key}": automountServiceAccountToken must be false`);
  }
  if ((pod.volumes ?? []).some((volume) => hasSecretVolume(volume))) {
    errors.push(`step "${key}": secret volumes are forbidden`);
  }
  const containers = auditPodContainers(pod, key);
  errors.push(...containers.errors);
  if (
    usesTestCollector(parsedStep.data.plugins) &&
    !containers.grants.some(
      (grant) => grantIdentity(grant) === grantIdentity(TEST_COLLECTOR_GRANT),
    )
  ) {
    errors.push(
      `step "${key}": test-collector requires ${displayGrant(TEST_COLLECTOR_GRANT)}`,
    );
  }
  if (containers.commandContainerCount !== 1) {
    errors.push(
      `step "${key}": expected one container-0, found ${String(containers.commandContainerCount)}`,
    );
  }
  const providedNames = new Set<string>([
    ...globalEnvNames,
    ...Object.entries(parsedStep.data.env ?? {})
      .filter(([, value]) => value !== "")
      .map(([name]) => name),
    ...containers.providedNames,
  ]);
  const scopes = commandScopes(command);
  const scripts = scopes.flatMap((scope) => scope.scripts);
  return {
    errors,
    step: {
      key,
      command,
      providedNames,
      grants: containers.grants,
      scripts: [...new Set(scripts)].toSorted(),
      invocations: scopes.flatMap((scope) =>
        scope.scripts.map((entry) => ({
          entry,
          providedNames: new Set([...providedNames, ...scope.assigned]),
        })),
      ),
    },
  };
}

export function collectSteps(
  pipeline: unknown,
  globalEnvNames: readonly string[],
): { steps: PipelineStep[]; errors: string[] } {
  const document = z
    .object({ steps: z.array(z.unknown()).optional() })
    .loose()
    .parse(pipeline);
  const steps: PipelineStep[] = [];
  const errors: string[] = [];
  for (const rawStep of document.steps ?? []) {
    const collected = collectStep(rawStep, globalEnvNames);
    errors.push(...collected.errors);
    if (collected.step !== undefined) steps.push(collected.step);
  }
  return { steps, errors };
}

export function compareStepGrants(
  steps: readonly PipelineStep[],
  expected: Readonly<Record<string, readonly SecretGrant[]>>,
): string[] {
  const errors: string[] = [];
  const actualKeys = new Set(steps.map((step) => step.key));
  for (const step of steps) {
    const grants = expected[step.key];
    if (grants === undefined) {
      errors.push(`step "${step.key}" is missing from secret-grants.json`);
      continue;
    }
    const actual = new Map(
      step.grants.map((grant) => [grantIdentity(grant), grant]),
    );
    const wanted = new Map(
      grants.map((grant) => [grantIdentity(grant), grant]),
    );
    for (const [identity, grant] of wanted) {
      if (!actual.has(identity)) {
        errors.push(
          `step "${step.key}" is missing grant ${displayGrant(grant)}`,
        );
      }
    }
    for (const [identity, grant] of actual) {
      if (!wanted.has(identity)) {
        errors.push(
          `step "${step.key}" has excessive grant ${displayGrant(grant)}`,
        );
      }
    }
    if (
      step.command.includes(". .buildkite/scripts/toolchain.sh") &&
      !step.grants.some((grant) => grant.env === "GITHUB_DOWNLOAD_TOKEN")
    ) {
      errors.push(
        `step "${step.key}" sources toolchain.sh without GITHUB_DOWNLOAD_TOKEN`,
      );
    }
  }
  for (const key of Object.keys(expected)) {
    if (!actualKeys.has(key)) {
      errors.push(`secret-grants.json names unknown step "${key}"`);
    }
  }
  return errors.toSorted();
}
