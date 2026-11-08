import type { Database } from "#infrastructure/database.ts";

/**
 * Stages whose work only reads and proves. Their Jobs or checks run before any
 * Application sync or routing change, so a deployment that failed in one of
 * them changed nothing.
 */
const READ_ONLY_STAGES: ReadonlySet<string> = new Set([
  "worker-prior-source",
  "worker-image-provenance",
  "worker-preflight",
]);

/** A compound recipe's sub-recipe prefixes its steps' keys (`sub2-step-sync`). */
function ownKey(key: string): string {
  return key.replace(/^sub[1-9]\d*-/u, "");
}

/**
 * A stage that cannot have left an effect behind: read-only work in any state,
 * or an apply-safety step the executor settled `failed`, which it records only
 * after restoring the Application body it wrote (temporal model/kubernetes.ts).
 */
function leftNoEffect(stage: { key: string; status: string }): boolean {
  const key = ownKey(stage.key);
  return (
    key.startsWith("test-") ||
    READ_ONLY_STAGES.has(key) ||
    (key === "step-apply-safety" && stage.status === "failed")
  );
}

/**
 * Whether a failed deployment provably changed nothing (D2): it is not
 * recovery-required, every stage it recorded left no effect, and one of them
 * settled `failed`, so the failure itself is on record. Anything else, a
 * failure with no recorded stage included, still blocks automatic successors.
 */
export async function failedWithoutEffect(
  database: Database,
  deployment: { id: string; status: string; recoveryRequired: boolean },
): Promise<boolean> {
  if (deployment.status !== "failed" || deployment.recoveryRequired)
    return false;
  const stages = await database.stage.findMany({
    where: { deploymentId: deployment.id },
    select: { key: true, status: true },
  });
  return (
    stages.some((stage) => stage.status === "failed") &&
    stages.every((stage) => leftNoEffect(stage))
  );
}
