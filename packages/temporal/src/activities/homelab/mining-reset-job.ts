import {
  MINING_CLAIM,
  MINING_NAMESPACE,
  miningBackupName,
  miningResetScript,
} from "./mining-reset-contract.ts";

/** The exact resumable Job shape used when a failed Pod must be replaced. */
export function resetJobManifest(period: string, image: string): string {
  return JSON.stringify({
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name: miningBackupName(period),
      namespace: MINING_NAMESPACE,
      labels: { "sjer.red/mining-reset-period": period },
    },
    spec: {
      backoffLimit: 0,
      activeDeadlineSeconds: 600,
      ttlSecondsAfterFinished: 604_800,
      template: {
        metadata: { labels: { "sjer.red/mining-reset-period": period } },
        spec: {
          restartPolicy: "Never",
          containers: [
            {
              name: "mining-reset",
              image,
              command: ["/bin/sh", "-eu", "-c", miningResetScript("/data")],
              env: [{ name: "RESET_PERIOD", value: period }],
              volumeMounts: [{ name: "data", mountPath: "/data" }],
              securityContext: {
                allowPrivilegeEscalation: false,
                runAsUser: 0,
              },
            },
          ],
          volumes: [
            {
              name: "data",
              persistentVolumeClaim: { claimName: MINING_CLAIM },
            },
          ],
        },
      },
    },
  });
}
