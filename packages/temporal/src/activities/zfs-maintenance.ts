import * as k8s from "@kubernetes/client-node";
import { PassThrough } from "node:stream";

function getK8sClients(): { coreApi: k8s.CoreV1Api; exec: k8s.Exec } {
  const kc = new k8s.KubeConfig();
  kc.loadFromCluster();
  return {
    coreApi: kc.makeApiClient(k8s.CoreV1Api),
    exec: new k8s.Exec(kc),
  };
}

export type ZfsMaintenanceActivities = typeof zfsMaintenanceActivities;

export const zfsMaintenanceActivities = {
  async runZfsMaintenance(): Promise<string> {
    const { coreApi, exec } = getK8sClients();

    const pods = await coreApi.listNamespacedPod({
      namespace: "prometheus",
      labelSelector: "app=zfs-zpool-collector",
    });

    const pod = pods.items.find((p) => p.status?.phase === "Running");
    if (pod?.metadata?.name === undefined) {
      throw new Error(
        "No running zfs-zpool-collector pod found in prometheus namespace",
      );
    }
    const podName = pod.metadata.name;

    const results: string[] = [];

    // Enable autotrim (idempotent; NVMe supports TRIM, HDD setting is a no-op)
    for (const pool of ["zfspv-pool-nvme", "zfspv-pool-hdd"]) {
      const out = await execInPod(
        exec,
        podName,
        `zpool set autotrim=on ${pool}`,
      );
      results.push(`autotrim ${pool}: ${out}`);
    }

    // Start scrub only if one is not already in progress
    for (const pool of ["zfspv-pool-nvme", "zfspv-pool-hdd"]) {
      const status = await execInPod(exec, podName, `zpool status ${pool}`);
      if (status.includes("scrub in progress")) {
        results.push(`scrub ${pool}: already in progress, skipped`);
      } else {
        const out = await execInPod(exec, podName, `zpool scrub ${pool}`);
        results.push(
          `scrub ${pool}: initiated (${out.trim() === "" ? "ok" : out.trim()})`,
        );
      }
    }

    return results.join("\n");
  },
};

async function execInPod(
  exec: k8s.Exec,
  podName: string,
  command: string,
): Promise<string> {
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
  stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

  return new Promise((resolve, reject) => {
    const run = async (): Promise<void> => {
      try {
        await exec.exec(
          "prometheus",
          podName,
          "zfs-zpool-collector",
          ["sh", "-c", command],
          stdout,
          stderr,
          null,
          false,
          (status: k8s.V1Status) => {
            const out = Buffer.concat(stdoutChunks).toString().trim();
            const err = Buffer.concat(stderrChunks).toString().trim();
            if (status.status === "Success") {
              resolve(out);
            } else {
              reject(
                new Error(
                  `Command "${command}" failed: ${err === "" ? (status.message ?? "unknown error") : err}`,
                ),
              );
            }
          },
        );
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    void run();
  });
}
