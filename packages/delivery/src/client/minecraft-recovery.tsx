import type { DeploymentDetail } from "#shared/contract.ts";

type RecoveryDetail = {
  pipeline: Pick<DeploymentDetail["pipeline"], "definition">;
  deployment: Pick<DeploymentDetail["deployment"], "id" | "recoveryRequired">;
  environment: Pick<DeploymentDetail["environment"], "generation">;
  stages: Pick<DeploymentDetail["stages"][number], "key">[];
  minecraftRecoveries: DeploymentDetail["minecraftRecoveries"];
};

/** Retained-volume releases have no separate restore procedure. */
export function MinecraftRecovery(_props: { detail: RecoveryDetail }) {
  return null;
}
