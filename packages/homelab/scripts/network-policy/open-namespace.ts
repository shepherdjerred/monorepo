#!/usr/bin/env bun

/**
 * EMERGENCY break-glass: put a namespace's staging policy
 * (`enforcement-staging-<namespace>`) back to allow-all, directly in the cluster. GitOps stays the normal path.
 *
 *   bun scripts/network-policy/open-namespace.ts <namespace>|--all
 *   bun scripts/network-policy/open-namespace.ts <namespace>|--all --apply --reason "<text>"
 *
 * Without `--apply` nothing is changed. The only object ever written is
 * that one NetworkPolicy; nothing is deleted.
 */
import { parseArgs } from "node:util";
import { stringify } from "yaml";
import { z } from "zod";
import {
  commandFailure,
  kubectlJson,
  runCommand,
  type CommandRunner,
} from "./command.ts";
import {
  BREAK_GLASS_FIELD_MANAGER,
  NamespaceNameSchema,
  namespacesWithPolicies,
  openStagingManifest,
  owningApplication,
  readNetworkPolicies,
  STAGE_MAP_PATH,
  stageLabel,
  stageOf,
  stagingPolicyName,
  stagingPolicyOf,
  type NetworkPolicy,
  type Stage,
  type StagingManifest,
} from "./staging-policy.ts";

/**
 * Server-side apply under its own field manager. `podSelector` is atomic and
 * owned by ArgoCD's manager, so taking it over is a conflict that must be
 * forced.
 */
export const APPLY_COMMAND = [
  "kubectl",
  "apply",
  "--server-side",
  "--force-conflicts",
  `--field-manager=${BREAK_GLASS_FIELD_MANAGER}`,
  "-f",
  "-",
] as const;

export type OpenOptions = {
  target: { namespace: string } | "all";
  apply: boolean;
  reason: string | undefined;
};

const USAGE =
  'Usage: open-namespace.ts <namespace>|--all [--apply --reason "<text>"]';

export function parseOpenArguments(argv: readonly string[]): OpenOptions {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      all: { type: "boolean" },
      apply: { type: "boolean" },
      reason: { type: "string" },
    },
  });
  const [namespace, ...extra] = positionals;
  const all = values.all === true;
  if (extra.length > 0 || (namespace === undefined) === !all) {
    throw new Error(USAGE);
  }
  const reason = values.reason?.trim();
  const apply = values.apply === true;
  if (apply && (reason === undefined || reason === "")) {
    throw new Error(
      `--apply changes the live cluster and requires --reason "<text>". ${USAGE}`,
    );
  }
  return {
    target:
      namespace === undefined
        ? "all"
        : { namespace: NamespaceNameSchema.parse(namespace) },
    apply,
    reason: reason === "" ? undefined : reason,
  };
}

export type OpenPlan = {
  namespace: string;
  before: Stage;
  /** `unchanged`: already open, so nothing is applied. */
  action: "create" | "update" | "unchanged";
  /** The ArgoCD Application that renders the live policy, when it has one. */
  application: string | undefined;
  manifest: StagingManifest;
};

function actionFor(before: Stage): OpenPlan["action"] {
  if (before === "none") {
    return "create";
  }
  return before === "open" ? "unchanged" : "update";
}

/** What opening each namespace changes, from the live policies. */
export function planOpen(
  namespaces: readonly string[],
  policies: readonly NetworkPolicy[],
  reason: string | undefined,
): OpenPlan[] {
  return namespaces.map((namespace) => {
    const policy = stagingPolicyOf(policies, namespace);
    const before = stageOf(policy);
    return {
      namespace,
      before,
      action: actionFor(before),
      application: policy === undefined ? undefined : owningApplication(policy),
      manifest: openStagingManifest(namespace, reason),
    };
  });
}

/** The source change that keeps a live opening from being reverted. */
export function reconcileInstruction(namespaces: readonly string[]): string {
  if (namespaces.length === 0) {
    return "Nothing was opened, so there is nothing to reconcile.";
  }
  return [
    "Reconcile to source. ArgoCD renders this policy from the stage map and",
    "reverts the live change at the owning Application's next sync; with",
    "self-heal that is within minutes. Until the source change is merged and",
    "synced, re-run this command if the namespace closes again.",
    `  ${STAGE_MAP_PATH}`,
    ...namespaces.map((namespace) => `    "${namespace}": "open"`),
  ].join("\n");
}

function describePlan(plan: OpenPlan): string {
  const change =
    plan.action === "unchanged"
      ? "already open, nothing to apply"
      : `${plan.action} ${stagingPolicyName(plan.namespace)}: ${stageLabel(plan.before)} -> open`;
  const owner =
    plan.application === undefined
      ? ""
      : ` (rendered by ArgoCD Application ${plan.application})`;
  return `Namespace ${plan.namespace}: ${change}${owner}`;
}

async function targetNamespaces(
  options: OpenOptions,
  policies: readonly NetworkPolicy[],
  run: CommandRunner,
): Promise<string[]> {
  if (options.target === "all") {
    return namespacesWithPolicies(policies);
  }
  const { namespace } = options.target;
  await kubectlJson(run, ["get", "namespace", namespace], z.object({}));
  return [namespace];
}

function dryRun(plans: readonly OpenPlan[], changing: readonly OpenPlan[]) {
  return [
    'DRY RUN: nothing is changed. Add --apply --reason "<text>" to apply.',
    "",
    ...plans.map((plan) => describePlan(plan)),
    "",
    ...changing.flatMap((plan) => ["---", stringify(plan.manifest).trimEnd()]),
    "",
    `Would run, once per manifest: ${APPLY_COMMAND.join(" ")}`,
    "",
    reconcileInstruction(changing.map((plan) => plan.namespace)),
  ].join("\n");
}

async function applyPlans(
  changing: readonly OpenPlan[],
  run: CommandRunner,
): Promise<{ lines: string[]; failed: boolean }> {
  const errors = new Map<string, string>();
  for (const plan of changing) {
    const result = await run(APPLY_COMMAND, JSON.stringify(plan.manifest));
    if (result.exitCode !== 0) {
      errors.set(plan.namespace, commandFailure(APPLY_COMMAND, result));
    }
  }
  const after = await readNetworkPolicies(run);
  const lines = changing.map((plan) => {
    const now = stageOf(stagingPolicyOf(after, plan.namespace));
    const error = errors.get(plan.namespace);
    if (error === undefined && now !== "open") {
      errors.set(plan.namespace, "the policy is not open after the apply");
    }
    const outcome = errors.get(plan.namespace);
    return `Namespace ${plan.namespace}: before ${stageLabel(plan.before)}, after ${stageLabel(now)}${outcome === undefined ? "" : ` FAILED: ${outcome}`}`;
  });
  return { lines, failed: errors.size > 0 };
}

/** Plans, and with `--apply` performs, the opening. Returns what to print. */
export async function runOpen(
  options: OpenOptions,
  run: CommandRunner,
): Promise<{ output: string; exitCode: number }> {
  const policies = await readNetworkPolicies(run);
  const namespaces = await targetNamespaces(options, policies, run);
  const plans = planOpen(namespaces, policies, options.reason);
  const changing = plans.filter((plan) => plan.action !== "unchanged");
  if (!options.apply) {
    return { output: dryRun(plans, changing), exitCode: 0 };
  }
  if (options.reason === undefined) {
    throw new Error("--apply requires --reason");
  }
  const applied = await applyPlans(changing, run);
  return {
    output: [
      `BREAK-GLASS APPLY, reason: ${options.reason}`,
      "",
      ...plans
        .filter((plan) => plan.action === "unchanged")
        .map((plan) => describePlan(plan)),
      ...applied.lines,
      "",
      reconcileInstruction(changing.map((plan) => plan.namespace)),
    ].join("\n"),
    exitCode: applied.failed ? 1 : 0,
  };
}

if (import.meta.main) {
  const result = await runOpen(
    parseOpenArguments(Bun.argv.slice(2)),
    runCommand,
  );
  console.log(result.output);
  process.exitCode = result.exitCode;
}
