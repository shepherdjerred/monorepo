/**
 * Labels that identify Woodpecker CI pods. Kept free of imports so the
 * network-policy scripts can read them without loading the cdk8s graph.
 */

/**
 * Label Woodpecker's Kubernetes backend stamps on every pod it creates --
 * clone, service, and step alike -- and nothing else carries. Its per-step
 * headless Service (`wp-hsvc-<task>`) selects on it.
 */
export const WOODPECKER_TASK_LABEL = "woodpecker-ci.org/task-uuid";

/**
 * Label every generated CI step and service pod carries.
 *
 * Written by the configuration extension's emitter
 * (`packages/woodpecker-config-extension/src/pipeline/emit.ts`) on both a
 * step and its services; Woodpecker's own pod names (`wp-<ulid>`) carry
 * nothing selectable. The value varies per step, so the policy selects on the
 * key's existence. macOS lanes run on the local backend and produce no pod,
 * so they are correctly outside this.
 *
 * The same key is duplicated in the monitoring rules for the same reason. Do
 * not rename it in one place.
 */
export const CI_STEP_POD_LABEL = "ci.sjer.red/step-key";
