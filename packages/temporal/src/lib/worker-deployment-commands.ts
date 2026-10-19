type RolloutCommandRunner = (
  command: readonly string[],
) => Promise<{ stdout: string; stderr: string }>;

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
  const internal =
    options.address ===
    "temporal-temporal-server-service.temporal.svc.cluster.local:7233";
  if (internal && options.tls === true)
    throw new Error(
      "The fixed in-cluster Temporal endpoint requires plaintext",
    );
  // Internal Jobs use the native CLI without external credential bootstrap.
  // Explicit connection flags follow the subcommand for both native and toolkit.
  return [
    ...(internal ? ["temporal"] : ["toolkit", "temporal"]),
    ...args,
    "--address",
    options.address,
    "--namespace",
    options.namespace,
    ...(internal
      ? ["--disable-config-env", "--disable-config-file", "--tls=false"]
      : options.tls === true
        ? ["--tls"]
        : []),
  ];
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
