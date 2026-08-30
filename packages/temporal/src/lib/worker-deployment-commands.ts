import type { RolloutCommandRunner } from "./worker-deployment-proofs.ts";

export function temporalPrefix(options: {
  address: string;
  namespace: string;
  tls?: boolean;
}): string[] {
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

export async function setRampingVersion(
  options: {
    address: string;
    namespace: string;
    tls?: boolean;
    deploymentName: string;
    buildId: string;
  },
  percentage: number,
  run: RolloutCommandRunner,
): Promise<void> {
  await run([
    ...temporalPrefix(options),
    "worker",
    "deployment",
    "set-ramping-version",
    "--deployment-name",
    options.deploymentName,
    "--build-id",
    options.buildId,
    "--percentage",
    String(percentage),
    "--yes",
    "--output",
    "json",
  ]);
}

export async function setCurrentVersion(
  options: {
    address: string;
    namespace: string;
    tls?: boolean;
    deploymentName: string;
  },
  buildId: string,
  run: RolloutCommandRunner,
): Promise<void> {
  await run([
    ...temporalPrefix(options),
    "worker",
    "deployment",
    "set-current-version",
    "--deployment-name",
    options.deploymentName,
    "--build-id",
    buildId,
    "--yes",
    "--output",
    "json",
  ]);
}
