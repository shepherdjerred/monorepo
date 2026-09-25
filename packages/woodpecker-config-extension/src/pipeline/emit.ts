import { stringify } from "yaml";
import type { CiStep, ResourceTier } from "#src/pipeline/model.ts";

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
 * Which agent may run this workflow.
 *
 * Woodpecker schedules a workflow onto any agent satisfying every label the
 * workflow asks for, so a workflow that asks for nothing is eligible for every
 * agent — including the Mac, whose `local` backend runs commands directly on
 * the host as the logged-in user with no container around them. Declaring the
 * label only on the macOS lanes was therefore half a guard: it kept mac work
 * off Linux, and did nothing to keep Linux work off the Mac.
 *
 * `backend` rather than `platform` because it names the property that actually
 * matters — container versus host shell — instead of coupling every workflow
 * to the CI node's architecture. Every agent advertises it automatically from
 * its engine name, so neither agent needs configuring to make this work.
 */
function agentLabels(step: CiStep): Record<string, string> {
  return {
    backend: step.backend === "local" ? "local" : "kubernetes",
    ...step.agentLabels,
  };
}

/**
 * Pod metadata the CI I/O telemetry attributes cgroup counters through.
 *
 * Woodpecker names step pods `wp-<ulid>`, which carries no information about
 * WHICH step ran. Buildkite's agent stack stamped a job UUID
 * and build/job URLs; nothing equivalent exists here, so the pipeline stamps
 * its own identity instead.
 *
 * Commit plus step key, rather than a pipeline number: the configuration
 * extension generates this YAML while the pipeline record is still being
 * created, and the `number` field in that request is not yet meaningful. A
 * commit and a step key do identify a job — except across a retry or a
 * push/pull_request pair on the same commit, where two pods can carry the same
 * pair. That is not silently wrong: the reporter's integrity check already
 * fails loudly when more than one pod maps to a job, so the ambiguity surfaces
 * as a refusal to report rather than as misattributed bytes.
 *
 * Branch is an annotation, not a label: branch names contain `/`, which is not
 * a legal label value.
 *
 * These keys are load-bearing outside this package. Their counterparts are the
 * kube-state-metrics allowlist in the homelab observability values and the
 * recording rules in `resources/monitoring/monitoring/rules/woodpecker.ts`,
 * which join on the flattened forms (`label_ci_sjer_red_step_key`,
 * `annotation_ci_sjer_red_branch`). Changing one without the others silently
 * empties the join.
 */
const POD_STEP_KEY_LABEL = "ci.sjer.red/step-key";
const POD_COMMIT_LABEL = "ci.sjer.red/commit";
const POD_BRANCH_ANNOTATION = "ci.sjer.red/branch";
const POD_PIPELINE_URL_ANNOTATION = "ci.sjer.red/pipeline-url";

/** Identity of the pipeline being generated, stamped onto every step pod. */
export type PipelineIdentity = {
  readonly commit: string;
  readonly branch: string;
  /** Forge URL for the commit this pipeline is building. */
  readonly linkUrl: string;
};

/**
 * The Woodpecker workflow timeout, in minutes.
 *
 * Woodpecker kills a whole workflow at its repository's timeout, whatever the
 * step's own budget says, so every step's worst case -- its timeout times its
 * attempts -- has to fit inside it with room for the clone. The server sets
 * this as both the default and the maximum
 * (`resources/woodpecker/index.ts` in the homelab cdk8s package); a repository
 * activated before that keeps the value it was activated with until its
 * settings are changed.
 */
export const WORKFLOW_TIMEOUT_MINUTES = 270;

/**
 * GNU timeout on the Mac, where macOS ships none. Homebrew's coreutils
 * installs it under a `g` prefix; `mac-ci/bootstrap.sh` provisions it. The path
 * is absolute because this runs before `macos-native-env.sh` puts Homebrew on
 * PATH.
 */
const MACOS_TIMEOUT = "/opt/homebrew/bin/gtimeout";

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
  const timeout = step.backend === "local" ? MACOS_TIMEOUT : "timeout";
  const attemptScript = `${timeout} ${seconds.toString()}s bash -euo pipefail -c ${shellQuote(body)}`;

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

function resources(tier: ResourceTier): Record<string, unknown> {
  return {
    requests: {
      cpu: tier.cpuRequest,
      memory: tier.memoryRequest,
      "ephemeral-storage": tier.ephemeralStorageRequest,
    },
    limits: {
      cpu: tier.cpuLimit,
      memory: tier.memoryLimit,
      "ephemeral-storage": tier.ephemeralStorageLimit,
    },
  };
}

/**
 * Pod shape shared by a step and its services.
 *
 * Services are separate pods, and Woodpecker gives them nothing a step
 * declares: without their own requests they would be invisible to Kueue and
 * the scheduler, and without the labels, to the telemetry and network policy
 * that select CI pods.
 */
function podOptions(
  step: CiStep,
  identity: PipelineIdentity,
  tier: ResourceTier,
): Record<string, unknown> {
  return {
    resources: resources(tier),
    nodeSelector: CI_NODE_SELECTOR,
    tolerations: [CI_TOLERATION],
    serviceAccountName: STEP_SERVICE_ACCOUNT,
    labels: {
      [POD_STEP_KEY_LABEL]: step.key,
      [POD_COMMIT_LABEL]: identity.commit,
    },
    annotations: {
      [POD_BRANCH_ANNOTATION]: identity.branch,
      [POD_PIPELINE_URL_ANNOTATION]: identity.linkUrl,
    },
  };
}

function backendOptions(
  step: CiStep,
  identity: PipelineIdentity,
): Record<string, unknown> {
  const secrets = (step.secrets ?? []).map((grant) => ({
    name: grant.secret,
    key: grant.key,
    target: { env: grant.env },
  }));

  return {
    kubernetes: {
      ...podOptions(step, identity, step.resources),
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
 *
 * The rendered text is escaped for Woodpecker's variable substitution; see
 * `escapeSubstitution`.
 */
export function emitWorkflow(step: CiStep, identity: PipelineIdentity): string {
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
          : { backend_options: backendOptions(step, identity) }),
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
            // Services hold no grants: nothing they run needs a credential.
            backend_options: {
              kubernetes: podOptions(step, identity, service.resources),
            },
          })),
        }),
    ...(step.dependsOn === undefined || step.dependsOn.length === 0
      ? {}
      : { depends_on: [...step.dependsOn] }),
    labels: agentLabels(step),
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

  return escapeSubstitution(stringify(workflow, { lineWidth: 0 }));
}

/**
 * Double every `$` so Woodpecker's substitution hands back exactly what was
 * emitted.
 *
 * Woodpecker runs every configuration -- extension-served ones included --
 * through envsubst before parsing it. That rewrites any braced `${NAME}`,
 * blanking names it does not know, and rejects bash forms such as
 * `"${array[@]}"` outright, failing the whole pipeline at compile time. None
 * of the emitted text is a Woodpecker template: steps read `CI_*` from their
 * environment at run time. envsubst turns `$$` back into `$`, so doubling is
 * exact rather than a guess about which forms it would have touched.
 */
export function escapeSubstitution(yaml: string): string {
  return yaml.replaceAll("$", () => "$$");
}

export function emitWorkflows(
  steps: readonly CiStep[],
  identity: PipelineIdentity,
): { name: string; data: string }[] {
  return steps.map((step) => ({
    name: `.woodpecker/${step.key}.yaml`,
    data: emitWorkflow(step, identity),
  }));
}
