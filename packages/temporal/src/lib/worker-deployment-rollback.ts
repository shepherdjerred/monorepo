import {
  prepareCandidatePinReset,
  prepareCandidatePinStateReset,
} from "./worker-deployment-catalog.ts";

type RollbackOptions = {
  address: string;
  namespace: string;
  tls?: boolean;
  deploymentName: string;
  buildId: string;
  catalogPath: string;
  candidateStatePath: string;
  candidatePinName?: string;
  stablePinName?: string;
};

type RollbackStatus = {
  currentBuildId: string | undefined;
  rampingBuildId: string | undefined;
  rampPercentage: number;
};

type RolloutCommandRunner = (
  command: readonly string[],
) => Promise<{ stdout: string; stderr: string }>;

function temporalPrefix(options: RollbackOptions): string[] {
  return [
    "toolkit",
    "temporal",
    "--address",
    options.address,
    "--namespace",
    options.namespace,
    ...(options.tls === true ? ["--tls"] : []),
  ];
}

export async function removeWorkerDeploymentRampingVersion(
  options: RollbackOptions,
  run: RolloutCommandRunner,
): Promise<void> {
  await run([
    ...temporalPrefix(options),
    "worker",
    "deployment",
    "set-ramping-version",
    "--deployment-name",
    options.deploymentName,
    "--delete",
    "--yes",
    "--output",
    "json",
  ]);
}

export async function executeWorkerDeploymentRollback(
  options: RollbackOptions,
  status: RollbackStatus,
  run: RolloutCommandRunner,
): Promise<void> {
  const activeRamp =
    status.rampingBuildId === options.buildId && status.rampPercentage > 0;
  if (status.rampPercentage > 0 && status.rampingBuildId !== options.buildId) {
    throw new Error(
      `Rollback target ${options.buildId} does not match active ramp ${String(status.rampingBuildId)}`,
    );
  }
  if (!activeRamp) {
    const candidatePinName =
      options.candidatePinName ??
      "shepherdjerred/temporal-worker/workflows/candidate";
    const resetCatalog = await prepareCandidatePinReset(
      options.catalogPath,
      candidatePinName,
      options.stablePinName,
    );
    const resetState = await prepareCandidatePinStateReset(
      options.candidateStatePath,
      candidatePinName,
    );
    if (status.currentBuildId === options.buildId) {
      throw new Error("Cannot reset the pin while the candidate is current");
    }
    if (!resetCatalog.changed) {
      throw new Error("Rollback requires the candidate to be actively ramping");
    }
    await Bun.write(options.catalogPath, resetCatalog.contents);
    if (resetState.changed) {
      await Bun.write(options.candidateStatePath, resetState.contents);
    }
    return;
  }
  await removeWorkerDeploymentRampingVersion(options, run);
}
