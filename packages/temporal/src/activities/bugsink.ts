import * as k8s from "@kubernetes/client-node";

const NAMESPACE = "bugsink";
const CONTAINER = "bugsink";

function loadCoreApi(): k8s.CoreV1Api {
  const kc = new k8s.KubeConfig();
  kc.loadFromCluster();
  return kc.makeApiClient(k8s.CoreV1Api);
}

export type BugsinkHousekeepingActivities =
  typeof bugsinkHousekeepingActivities;

export const bugsinkHousekeepingActivities = {
  async runBugsinkHousekeeping(): Promise<string> {
    const podName = await findRunningBugsinkPod();

    const commands: string[][] = [
      ["bugsink-manage", "delete_old_events", "--days", "180"],
      ["bugsink-manage", "vacuum_tags"],
      ["bugsink-manage", "vacuum_files"],
      ["bugsink-manage", "vacuum_eventless_issuetags"],
      ["bugsink-manage", "cleanup_eventstorage", "default"],
    ];

    const results: string[] = [];
    for (const command of commands) {
      const out = await kubectlExec(podName, command);
      const trimmed = out.trim();
      results.push(`${command.join(" ")}: ${trimmed === "" ? "ok" : trimmed}`);
    }
    return results.join("\n");
  },
};

async function findRunningBugsinkPod(): Promise<string> {
  const pods = await loadCoreApi().listNamespacedPod({
    namespace: NAMESPACE,
    labelSelector: "app=bugsink",
  });
  const pod = pods.items.find((p) => p.status?.phase === "Running");
  const name = pod?.metadata?.name;
  if (name === undefined) {
    throw new Error(`No running bugsink pod found in ${NAMESPACE} namespace`);
  }
  return name;
}

// `kubectl exec` is used here in place of @kubernetes/client-node's
// WebSocket-based Exec because the latter rejects with opaque DOM-style
// ErrorEvent objects under Bun (the library targets Node's `ws` shim, which
// Bun doesn't replicate exactly). Pod discovery via the HTTP API still works
// and is kept above.
async function kubectlExec(
  podName: string,
  command: string[],
): Promise<string> {
  const args = [
    "kubectl",
    "exec",
    "--namespace",
    NAMESPACE,
    "--container",
    CONTAINER,
    podName,
    "--",
    ...command,
  ];
  const proc = Bun.spawn(args, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    const detail = stderr.trim() || stdout.trim() || "(no output)";
    throw new Error(
      `kubectl exec [${command.join(" ")}] in ${NAMESPACE}/${podName} exited ${String(exitCode)}: ${detail}`,
    );
  }
  return stdout;
}
