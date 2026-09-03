import type { RolloutCommandRunner } from "./worker-deployment-proofs.ts";

export function parseTemporalJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON`, { cause: error });
  }
}

export function temporalCommand(
  options: { address: string; namespace: string; tls?: boolean },
  args: readonly string[],
): string[] {
  // Temporal CLI connection flags must follow the subcommand when invoked
  // through toolkit's passthrough. Keep the operator-selected endpoint
  // explicit instead of relying on a local profile or environment defaults.
  return [
    "toolkit",
    "temporal",
    ...args,
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
  await run(
    temporalCommand(options, [
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
    ]),
  );
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
  await run(
    temporalCommand(options, [
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
    ]),
  );
}
