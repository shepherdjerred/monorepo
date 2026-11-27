import {
  PooledAdmissionBudgetSchema,
  queueWorkflows,
} from "@shepherdjerred/root-scripts/lib/ci/admission-budget.ts";
import rawCiAdmissionBudget from "./ci-admission-budget.json" with { type: "json" };

/**
 * The CI admission budget, from its language-neutral source
 * (`ci-admission-budget.json`), which the root admission-budget check also
 * reads to prove the generated pipeline fits it.
 */
export const CI_ADMISSION_BUDGET =
  PooledAdmissionBudgetSchema.parse(rawCiAdmissionBudget);

/**
 * Zero omits the legacy agent. Any enabled legacy capacity also counts toward
 * compute admission; reducing it requires draining its unlabelled workflows.
 */
export const WOODPECKER_MAX_WORKFLOWS = CI_ADMISSION_BUDGET.legacyMaxWorkflows;

export type CiAgentPool = keyof typeof CI_ADMISSION_BUDGET.pools;

/** Every pool whose pods queue for compute quota: PR, main and maintenance. */
export const CI_COMPUTE_WORKFLOWS =
  CI_ADMISSION_BUDGET.legacyMaxWorkflows +
  queueWorkflows(CI_ADMISSION_BUDGET.pools, "default");

/** The pr-light pool: short, service-free PR checks in a reserved queue. */
export const CI_LIGHT_WORKFLOWS = queueWorkflows(
  CI_ADMISSION_BUDGET.pools,
  "ci-light",
);

export const CI_GATE_WORKFLOWS = queueWorkflows(
  CI_ADMISSION_BUDGET.pools,
  "ci-gates",
);

/**
 * Label on every agent Deployment carrying its `WOODPECKER_MAX_WORKFLOWS`.
 *
 * kube-state-metrics exports it (`deployments=[...]` in its label allowlist,
 * resources/argo-applications/observability/grafana-values.ts) as
 * `kube_deployment_labels{label_ci_sjer_red_max_workflows}`, and the
 * `WoodpeckerAgentDisconnected` alert sums it over the available agents. That
 * makes the alert's expected capacity what the cluster runs, not what this
 * source says: the two differ between a cap change merging and its agent
 * rollout. The three places must agree; each names the others.
 */
export const CI_AGENT_MAX_WORKFLOWS_LABEL = "ci.sjer.red/max-workflows";

/** Public origin GitHub reaches for webhooks and OAuth callbacks. */
export const WOODPECKER_PUBLIC_HOST = "https://woodpecker.sjer.red";

/** Port the server serves HTTP (web UI, webhooks, OAuth) on. */
export const WOODPECKER_HTTP_PORT = 8000;

/** Port agents reach the server's gRPC endpoint on. */
export const WOODPECKER_GRPC_PORT = 9000;
