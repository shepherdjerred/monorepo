import { Context } from "@temporalio/activity";

// Daemonset name in the prometheus namespace. The pod has only cdk8s-generated
// labels (cdk8s.io/metadata.addr=apps-zfs-zpool-collector-<hash>), so we cannot
// select by `app=zfs-zpool-collector`. `kubectl exec daemonset/<name>` resolves
// to the daemonset's pod directly and is stable across pod-template-generation
// rollouts.
const NAMESPACE = "prometheus";
const TARGET = "daemonset/zfs-zpool-collector";
const POOLS = ["zfspv-pool-nvme", "zfspv-pool-hdd"] as const;

export type ZfsMaintenanceActivities = typeof zfsMaintenanceActivities;

export const zfsMaintenanceActivities = {
  async runZfsMaintenance(): Promise<string> {
    const results: string[] = [];

    // Enable autotrim (idempotent; NVMe supports TRIM, HDD setting is a no-op)
    for (const pool of POOLS) {
      Context.current().heartbeat({ phase: "autotrim", pool });
      const out = await execInPod(`zpool set autotrim=on ${pool}`);
      results.push(
        `autotrim ${pool}: ${out.trim() === "" ? "ok" : out.trim()}`,
      );
    }

    // Start scrub only if one is not already in progress
    for (const pool of POOLS) {
      Context.current().heartbeat({ phase: "scrub", pool });
      const status = await execInPod(`zpool status ${pool}`);
      if (status.includes("scrub in progress")) {
        results.push(`scrub ${pool}: already in progress, skipped`);
      } else {
        const out = await execInPod(`zpool scrub ${pool}`);
        results.push(
          `scrub ${pool}: initiated (${out.trim() === "" ? "ok" : out.trim()})`,
        );
      }
    }

    return results.join("\n");
  },
};

async function execInPod(command: string): Promise<string> {
  const args = [
    "kubectl",
    "exec",
    "-n",
    NAMESPACE,
    TARGET,
    "--",
    "sh",
    "-c",
    command,
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
      `zfs command "${command}" exited ${String(exitCode)}: ${detail}`,
    );
  }
  return stdout;
}
