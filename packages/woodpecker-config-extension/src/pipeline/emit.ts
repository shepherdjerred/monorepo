import { stringify } from "yaml";
import type { CiStep } from "#src/pipeline/model.ts";

/**
 * Node the CI step pods run on, and the taint they must tolerate to get there.
 *
 * Mirrors the Buildkite agent stack: CI never falls back onto the production
 * node. If the CI node is down, steps stay pending rather than displacing
 * production workloads.
 */
const CI_NODE_SELECTOR = { "kubernetes.io/hostname": "liskov" } as const;
const CI_TOLERATION = {
  key: "ci",
  operator: "Equal",
  value: "only",
  effect: "NoSchedule",
} as const;

/** Tokenless identity for step pods — no Kubernetes API access. */
const STEP_SERVICE_ACCOUNT = "woodpecker-job";

/**
 * Wrap a step's commands so they inherit the guarantees Woodpecker's step
 * schema does not provide.
 *
 * Woodpecker has neither a per-step timeout nor step retries, so both are
 * expressed in the shell instead of declaratively. `timeout` bounds each
 * attempt rather than the whole loop, so a hung attempt cannot consume the
 * budget for the rest; the pipeline-level timeout remains the outer backstop.
 */
export function wrapCommands(step: CiStep): string[] {
  const seconds = step.timeoutMinutes * 60;
  const body = step.commands.join("\n");
  const attemptScript = `timeout ${seconds.toString()}s bash -euo pipefail -c ${shellQuote(body)}`;

  if (step.retries === undefined || step.retries <= 1) {
    return [attemptScript];
  }

  // A plain `for` loop rather than a helper binary: the CI image is shared
  // with developer machines and should not need extra tooling to run a step.
  return [
    [
      `for attempt in $(seq 1 ${step.retries.toString()}); do`,
      `  if ${attemptScript}; then exit 0; fi`,
      `  echo "attempt $attempt of ${step.retries.toString()} failed" >&2`,
      "done",
      "exit 1",
    ].join("\n"),
  ];
}

/** Single-quote a string for POSIX sh, escaping embedded single quotes. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

function backendOptions(step: CiStep): Record<string, unknown> {
  const secrets = (step.secrets ?? []).map((grant) => ({
    name: grant.secret,
    key: grant.key,
    target: { env: grant.env },
  }));

  return {
    kubernetes: {
      resources: {
        requests: {
          cpu: step.resources.cpuRequest,
          memory: step.resources.memoryRequest,
          "ephemeral-storage": step.resources.ephemeralStorageRequest,
        },
        limits: {
          cpu: step.resources.cpuLimit,
          memory: step.resources.memoryLimit,
          "ephemeral-storage": step.resources.ephemeralStorageLimit,
        },
      },
      nodeSelector: CI_NODE_SELECTOR,
      tolerations: [CI_TOLERATION],
      serviceAccountName: STEP_SERVICE_ACCOUNT,
      labels: { "ci.sjer.red/step-key": step.key },
      ...(secrets.length > 0 ? { secrets } : {}),
    },
  };
}

/**
 * Render one step as a complete Woodpecker workflow.
 *
 * One workflow per step rather than one workflow containing many: Buildkite
 * steps were independent pods with their own checkout, and Woodpecker
 * workflows are the unit that gets its own workspace — and the unit
 * `concurrency` applies to, which the serialized lanes depend on.
 *
 * Deliberately emits no `when` clause. The selector has already decided which
 * steps run, using the same changed-file list Woodpecker would filter on, and
 * it guarantees the result is dependency-closed. Emitting `when: path` as well
 * would filter a second time against a graph that no longer expects it, and a
 * workflow whose dependency was filtered out never becomes runnable — a lane
 * that silently never runs rather than one that fails.
 */
export function emitWorkflow(step: CiStep): string {
  const workflow: Record<string, unknown> = {
    steps: [
      {
        name: step.key,
        image: step.image,
        commands: wrapCommands(step),
        ...(step.environment === undefined ||
        Object.keys(step.environment).length === 0
          ? {}
          : { environment: { ...step.environment } }),
        ...(step.volumes === undefined || step.volumes.length === 0
          ? {}
          : {
              volumes: step.volumes.map(
                (volume) => `${volume.claim}:${volume.path}`,
              ),
            }),
        ...(step.allowFailure === true ? { failure: "ignore" } : {}),
        // A local-backend step runs on a host with no pod around it, so a pod
        // spec would be meaningless -- and Kubernetes secret grants would
        // silently deliver nothing.
        ...(step.backend === "local"
          ? {}
          : { backend_options: backendOptions(step) }),
      },
    ],
    ...(step.services === undefined || step.services.length === 0
      ? {}
      : {
          services: step.services.map((service) => ({
            name: service.name,
            image: service.image,
            ...(service.commands === undefined
              ? {}
              : { commands: [...service.commands] }),
            ...(service.environment === undefined
              ? {}
              : { environment: { ...service.environment } }),
          })),
        }),
    ...(step.dependsOn === undefined || step.dependsOn.length === 0
      ? {}
      : { depends_on: [...step.dependsOn] }),
    ...(step.agentLabels === undefined
      ? {}
      : { labels: { ...step.agentLabels } }),
    ...(step.concurrency === undefined
      ? {}
      : {
          concurrency: {
            limit: step.concurrency.limit,
            ...(step.concurrency.group === undefined
              ? {}
              : { group: step.concurrency.group }),
          },
        }),
  };

  return stringify(workflow, { lineWidth: 0 });
}

export function emitWorkflows(
  steps: readonly CiStep[],
): { name: string; data: string }[] {
  return steps.map((step) => ({
    name: `.woodpecker/${step.key}.yaml`,
    data: emitWorkflow(step),
  }));
}
