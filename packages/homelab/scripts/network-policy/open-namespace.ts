#!/usr/bin/env bun

/**
 * EMERGENCY break-glass: open a namespace at once with a separate allow-all
 * NetworkPolicy, `enforcement-break-glass-<namespace>`, that ArgoCD does not
 * track. GitOps stays the normal path.
 *
 *   bun scripts/network-policy/open-namespace.ts <namespace>|--all
 *   bun scripts/network-policy/open-namespace.ts <namespace>|--all --apply --reason "<text>"
 *   bun scripts/network-policy/open-namespace.ts <namespace>|--all --close [--apply]
 *
 * Without `--apply` nothing is changed. The break-glass policy is the only
 * object ever written or deleted; the staging policy and every other policy
 * are left alone.
 */
import { parseArgs } from "node:util";
import { stringify } from "yaml";
import { z } from "zod";
import {
  BREAK_GLASS_FIELD_MANAGER,
  BREAK_GLASS_LABEL,
  breakGlassCandidates,
  breakGlassManifest,
  breakGlassNamespaces,
  breakGlassPolicyName,
  breakGlassState,
  refusalOf,
  type BreakGlassManifest,
  type BreakGlassState,
} from "./break-glass.ts";
import {
  commandFailure,
  kubectlJson,
  runCommand,
  type CommandRunner,
} from "./command.ts";
import {
  NamespaceNameSchema,
  namespacesWithPolicies,
  readNetworkPolicies,
  STAGE_MAP_PATH,
  stageLabel,
  stageOf,
  stagingPolicyOf,
  type NetworkPolicy,
  type Stage,
} from "./staging-policy.ts";

/** Nothing else owns the object, so no conflict has to be forced. */
export const APPLY_COMMAND = [
  "kubectl",
  "apply",
  "--server-side",
  `--field-manager=${BREAK_GLASS_FIELD_MANAGER}`,
  "-f",
  "-",
] as const;

/**
 * Deletes by label AND name, both matched by the API server, so an object
 * that stopped matching since it was read is not deleted.
 */
export function deleteCommand(namespace: string): string[] {
  return [
    "kubectl",
    "--namespace",
    namespace,
    "delete",
    "networkpolicies.networking.k8s.io",
    "--selector",
    `${BREAK_GLASS_LABEL}=true`,
    "--field-selector",
    `metadata.name=${breakGlassPolicyName(namespace)}`,
  ];
}

export type OpenOptions = {
  target: { namespace: string } | "all";
  mode: "open" | "close";
  apply: boolean;
  reason: string | undefined;
};

const USAGE =
  'Usage: open-namespace.ts <namespace>|--all [--apply --reason "<text>"]\n' +
  "       open-namespace.ts <namespace>|--all --close [--apply]";

export function parseOpenArguments(argv: readonly string[]): OpenOptions {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      all: { type: "boolean" },
      apply: { type: "boolean" },
      close: { type: "boolean" },
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
  const closing = values.close === true;
  if (closing && reason !== undefined) {
    throw new Error(`--close takes no --reason. ${USAGE}`);
  }
  if (apply && !closing && (reason === undefined || reason === "")) {
    throw new Error(
      `--apply changes the live cluster and requires --reason "<text>". ${USAGE}`,
    );
  }
  return {
    target:
      namespace === undefined
        ? "all"
        : { namespace: NamespaceNameSchema.parse(namespace) },
    mode: closing ? "close" : "open",
    apply,
    reason: reason === "" ? undefined : reason,
  };
}

export type OpenDependencies = { run: CommandRunner; now: () => Date };
type Outcome = { output: string; exitCode: number };

export type OpenPlan = {
  namespace: string;
  staging: Stage;
  before: BreakGlassState;
  /** `refresh`: the policy exists; applying rewrites its record. */
  action: "create" | "refresh";
  manifest: BreakGlassManifest;
};

/** What opening each namespace applies, from the live policies. */
export function planOpen(
  namespaces: readonly string[],
  policies: readonly NetworkPolicy[],
  record: { reason: string; operator: string; at: Date },
): OpenPlan[] {
  return namespaces.map((namespace) => ({
    namespace,
    staging: stageOf(stagingPolicyOf(policies, namespace)),
    before: breakGlassState(policies, namespace),
    action: policies.some(
      (policy) =>
        policy.metadata.namespace === namespace &&
        policy.metadata.name === breakGlassPolicyName(namespace),
    )
      ? "refresh"
      : "create",
    manifest: breakGlassManifest(namespace, record),
  }));
}

/** How a break-glass opening is made permanent in source and then removed. */
export function reconcileInstruction(namespaces: readonly string[]): string {
  if (namespaces.length === 0) {
    return "Nothing was opened, so there is nothing to reconcile.";
  }
  const [only, ...others] = namespaces;
  const target = only !== undefined && others.length === 0 ? only : "--all";
  return [
    "Reconcile, then close. ArgoCD does not track this policy, so it survives",
    "self-heal and prune and stays until it is closed; netpol:check fails",
    "while it exists.",
    `  1. In ${STAGE_MAP_PATH} set:`,
    ...namespaces.map((namespace) => `       "${namespace}": "open"`),
    "     Merge it and wait for ArgoCD to sync, so the namespace stays open.",
    `  2. bun run netpol:open ${target} --close --apply`,
  ].join("\n");
}

function describeOpen(plan: OpenPlan): string {
  return `Namespace ${plan.namespace}: ${plan.action} ${plan.manifest.metadata.name} (staging policy: ${stageLabel(plan.staging)}; break-glass before: ${plan.before})`;
}

async function existingNamespace(
  namespace: string,
  run: CommandRunner,
): Promise<string> {
  await kubectlJson(run, ["get", "namespace", namespace], z.object({}));
  return namespace;
}

async function currentContext(run: CommandRunner): Promise<string> {
  const command = ["kubectl", "config", "current-context"];
  const result = await run(command);
  const context = result.stdout.trim();
  if (context === "" || result.exitCode !== 0) {
    throw new Error(commandFailure(command, result));
  }
  return context;
}

async function applyPlans(
  plans: readonly OpenPlan[],
  run: CommandRunner,
): Promise<{ lines: string[]; failed: boolean }> {
  const errors = new Map<string, string>();
  for (const plan of plans) {
    const result = await run(APPLY_COMMAND, JSON.stringify(plan.manifest));
    if (result.exitCode !== 0) {
      errors.set(plan.namespace, commandFailure(APPLY_COMMAND, result));
    }
  }
  const after = await readNetworkPolicies(run);
  const lines = plans.map((plan) => {
    const now = breakGlassState(after, plan.namespace);
    if (now !== "open" && !errors.has(plan.namespace)) {
      errors.set(plan.namespace, "no open break-glass policy after the apply");
    }
    const error = errors.get(plan.namespace);
    return `Namespace ${plan.namespace}: break-glass before ${plan.before}, after ${now}${error === undefined ? "" : ` FAILED: ${error}`}`;
  });
  return { lines, failed: errors.size > 0 };
}

async function open(
  options: OpenOptions,
  { run, now }: OpenDependencies,
): Promise<Outcome> {
  const policies = await readNetworkPolicies(run);
  const namespaces =
    options.target === "all"
      ? namespacesWithPolicies(policies)
      : [await existingNamespace(options.target.namespace, run)];
  const plans = planOpen(namespaces, policies, {
    reason: options.reason ?? '<the --reason "<text>" given with --apply>',
    operator: await currentContext(run),
    at: now(),
  });
  const reconcile = reconcileInstruction(namespaces);
  if (!options.apply) {
    return {
      output: [
        'DRY RUN: nothing is changed. Add --apply --reason "<text>" to apply.',
        "",
        ...plans.map((plan) => describeOpen(plan)),
        "",
        ...plans.flatMap((plan) => ["---", stringify(plan.manifest).trimEnd()]),
        "",
        `Would run, once per manifest: ${APPLY_COMMAND.join(" ")}`,
        "",
        reconcile,
      ].join("\n"),
      exitCode: 0,
    };
  }
  const applied = await applyPlans(plans, run);
  return {
    output: [
      `BREAK-GLASS APPLY, reason: ${options.reason ?? ""}`,
      "",
      ...applied.lines,
      "",
      reconcile,
    ].join("\n"),
    exitCode: applied.failed ? 1 : 0,
  };
}

export type ClosePlan = {
  namespace: string;
  /** The staging stage that governs the namespace once the policy is gone. */
  staging: Stage;
  /** Whether the one deletable break-glass policy exists. */
  deletable: boolean;
  /** Candidates that are refused, each with the reason. */
  refused: string[];
};

/** What closing each namespace deletes, and what it refuses to. */
export function planClose(
  namespaces: readonly string[],
  policies: readonly NetworkPolicy[],
): ClosePlan[] {
  return namespaces.map((namespace) => {
    const candidates = breakGlassCandidates(policies, namespace);
    return {
      namespace,
      staging: stageOf(stagingPolicyOf(policies, namespace)),
      deletable: candidates.some((policy) => refusalOf(policy) === undefined),
      refused: candidates.flatMap((policy) => {
        const refusal = refusalOf(policy);
        return refusal === undefined
          ? []
          : [`REFUSED ${namespace}/${policy.metadata.name}: ${refusal}`];
      }),
    };
  });
}

function describeClose(plan: ClosePlan, verb: string): string[] {
  const name = `${plan.namespace}/${breakGlassPolicyName(plan.namespace)}`;
  const governed =
    plan.staging === "open"
      ? "the staging policy keeps the namespace open"
      : `the namespace is then governed by its staging policy: ${stageLabel(plan.staging)}`;
  return [
    plan.deletable
      ? `Namespace ${plan.namespace}: ${verb} ${name}; ${governed}`
      : `Namespace ${plan.namespace}: no break-glass policy to delete`,
    ...plan.refused,
  ];
}

async function close(
  options: OpenOptions,
  { run }: OpenDependencies,
): Promise<Outcome> {
  const policies = await readNetworkPolicies(run);
  const namespaces =
    options.target === "all"
      ? breakGlassNamespaces(policies)
      : [await existingNamespace(options.target.namespace, run)];
  const plans = planClose(namespaces, policies);
  const refused = plans.some((plan) => plan.refused.length > 0);
  if (!options.apply) {
    return {
      output: [
        "DRY RUN: nothing is changed. Add --apply to delete.",
        "",
        ...(plans.length === 0 ? ["No break-glass policy exists."] : []),
        ...plans.flatMap((plan) => describeClose(plan, "would delete")),
      ].join("\n"),
      exitCode: refused ? 1 : 0,
    };
  }
  const errors: string[] = [];
  for (const plan of plans.filter((entry) => entry.deletable)) {
    const command = deleteCommand(plan.namespace);
    const result = await run(command);
    if (result.exitCode !== 0) {
      errors.push(`FAILED ${commandFailure(command, result)}`);
    }
  }
  const after = await readNetworkPolicies(run);
  for (const plan of plans) {
    if (
      plan.deletable &&
      planClose([plan.namespace], after).some((entry) => entry.deletable)
    ) {
      errors.push(`FAILED ${plan.namespace}: the policy still exists`);
    }
  }
  return {
    output: [
      "BREAK-GLASS CLOSE",
      "",
      ...(plans.length === 0 ? ["No break-glass policy exists."] : []),
      ...plans.flatMap((plan) => describeClose(plan, "deleted")),
      ...errors,
    ].join("\n"),
    exitCode: refused || errors.length > 0 ? 1 : 0,
  };
}

/** Plans, and with `--apply` performs, the opening or the closing. */
export async function runOpen(
  options: OpenOptions,
  dependencies: OpenDependencies,
): Promise<Outcome> {
  return options.mode === "close"
    ? close(options, dependencies)
    : open(options, dependencies);
}

if (import.meta.main) {
  const result = await runOpen(parseOpenArguments(Bun.argv.slice(2)), {
    run: runCommand,
    now: () => new Date(),
  });
  console.log(result.output);
  process.exitCode = result.exitCode;
}
