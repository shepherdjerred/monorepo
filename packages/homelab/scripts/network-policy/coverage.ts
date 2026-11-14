/**
 * The pre-switch gate: does every namespace whose policies would start to
 * bite have its staging policy? Switching enforcement on is only harmless
 * where an open staging policy selects the pods the other policies select.
 */
import { z } from "zod";
import { alignedRows } from "./report.ts";
import {
  stageLabel,
  stageOf,
  stagingPolicyName,
  stagingPolicyOf,
  type NetworkPolicy,
  type Stage,
} from "./staging-policy.ts";

export const PodSummarySchema = z.object({
  metadata: z.object({ namespace: z.string() }),
  status: z.object({ phase: z.string().optional() }),
});
export type PodSummary = z.infer<typeof PodSummarySchema>;

/**
 * - `staged`: the staging policy exists, open or enforced.
 * - `no pods`: no staging policy, and no pod for a policy to select.
 * - `allowed`: no staging policy, excused by an `--allow-unstaged` entry.
 * - `unstaged`: policies and pods but no staging policy. Fails.
 * - `unrecognized`: a staging policy that is neither open nor enforced. Fails.
 */
export type CoverageResult =
  "staged" | "no pods" | "allowed" | "unstaged" | "unrecognized";

export type CoverageRow = {
  namespace: string;
  /** NetworkPolicies other than the namespace's own staging policy. */
  policies: number;
  /** Pods a policy can select: every pod that has not finished. */
  pods: number;
  stage: Stage;
  result: CoverageResult;
};

export type CoverageReport = { ok: boolean; rows: CoverageRow[] };

/**
 * An allow entry is a namespace name, or a prefix when it ends in `-` or `*`
 * (`pg18-rehearsal-`, `ops-restore-*`).
 */
export function allowsUnstaged(
  namespace: string,
  allow: readonly string[],
): boolean {
  return allow.some((entry) => {
    if (entry.endsWith("*")) {
      return namespace.startsWith(entry.slice(0, -1));
    }
    return entry.endsWith("-")
      ? namespace.startsWith(entry)
      : namespace === entry;
  });
}

function resultOf(
  stage: Stage,
  pods: number,
  allowed: boolean,
): CoverageResult {
  if (stage === "unrecognized") {
    return "unrecognized";
  }
  if (stage !== "none") {
    return "staged";
  }
  if (pods === 0) {
    return "no pods";
  }
  return allowed ? "allowed" : "unstaged";
}

/** One row per namespace that has a policy other than its own staging policy. */
export function coverageReport(
  policies: readonly NetworkPolicy[],
  pods: readonly PodSummary[],
  allow: readonly string[],
): CoverageReport {
  const counts = new Map<string, number>();
  for (const policy of policies) {
    const { name, namespace } = policy.metadata;
    if (name !== stagingPolicyName(namespace)) {
      counts.set(namespace, (counts.get(namespace) ?? 0) + 1);
    }
  }
  const rows = [...counts]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([namespace, count]): CoverageRow => {
      const stage = stageOf(stagingPolicyOf(policies, namespace));
      const live = pods.filter(
        (pod) =>
          pod.metadata.namespace === namespace &&
          pod.status.phase !== "Succeeded" &&
          pod.status.phase !== "Failed",
      ).length;
      return {
        namespace,
        policies: count,
        pods: live,
        stage,
        result: resultOf(stage, live, allowsUnstaged(namespace, allow)),
      };
    });
  return { ok: rows.every((row) => !failed(row)), rows };
}

function failed(row: CoverageRow): boolean {
  return row.result === "unstaged" || row.result === "unrecognized";
}

export function renderCoverage(report: CoverageReport): string {
  const failing = report.rows.filter((row) => failed(row));
  return [
    ...alignedRows([
      ["NAMESPACE", "POLICIES", "PODS", "STAGING", "RESULT"],
      ...report.rows.map((row) => [
        row.namespace,
        String(row.policies),
        String(row.pods),
        stageLabel(row.stage),
        failed(row) ? `FAIL (${row.result})` : row.result,
      ]),
    ]),
    "",
    report.ok
      ? `PASS: all ${String(report.rows.length)} namespaces with policies are staged, empty or allowed`
      : `FAIL: ${String(failing.length)}/${String(report.rows.length)} namespaces have policies and pods but no usable staging policy: ${failing.map((row) => row.namespace).join(", ")}`,
  ].join("\n");
}
