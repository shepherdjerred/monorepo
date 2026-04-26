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

export type BugsinkHousekeepingActivities =
  typeof bugsinkHousekeepingActivities;

export const bugsinkHousekeepingActivities = {
  async runBugsinkHousekeeping(): Promise<string> {
    const { coreApi, exec } = getK8sClients();

    const pods = await coreApi.listNamespacedPod({
      namespace: "bugsink",
      labelSelector: "app=bugsink",
    });

    const pod = pods.items.find((p) => p.status?.phase === "Running");
    if (pod?.metadata?.name === undefined) {
      throw new Error("No running bugsink pod found in bugsink namespace");
    }
    const podName = pod.metadata.name;

    const commands = [
      ["bugsink-manage", "delete_old_events", "--days", "180"],
      ["bugsink-manage", "vacuum_tags"],
      ["bugsink-manage", "vacuum_files"],
      ["bugsink-manage", "vacuum_eventless_issuetags"],
      ["bugsink-manage", "cleanup_eventstorage", "default"],
    ];

    const results: string[] = [];
    for (const command of commands) {
      const out = await execInPod(exec, podName, command);
      results.push(
        `${command.join(" ")}: ${out.trim() === "" ? "ok" : out.trim()}`,
      );
    }

    return results.join("\n");
  },
};

async function execInPod(
  exec: k8s.Exec,
  podName: string,
  command: string[],
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
          "bugsink",
          podName,
          "bugsink",
          command,
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
                  `Command "${command.join(" ")}" failed: ${err === "" ? (status.message ?? "unknown error") : err}`,
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
