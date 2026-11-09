import { z } from "zod";

export const CaptureResourceInput = z.strictObject({
  id: z.uuid(),
  sourceClaim: z.literal("datadir-minecraft-tsmc-0"),
  capacity: z.string().regex(/^\d+Gi$/u),
  image: z.string().regex(/^.+@sha256:[a-f0-9]{64}$/u),
  imagePullSecrets: z
    .array(
      z.strictObject({
        name: z
          .string()
          .min(1)
          .max(253)
          .regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u),
      }),
    )
    .min(1),
});

/** On-demand fixture reads use their own disposable class, never a writable source mount. */
export function captureResources(value: unknown) {
  const input = CaptureResourceInput.parse(value);
  const name = `mc-capture-${input.id}`;
  const metadata = {
    name,
    namespace: "minecraft-tsmc",
    labels: { "sjer.red/mc-capture": input.id },
  };
  return {
    apiVersion: "v1",
    kind: "List",
    items: [
      {
        apiVersion: "snapshot.storage.k8s.io/v1",
        kind: "VolumeSnapshot",
        metadata,
        spec: {
          volumeSnapshotClassName: "host-zfs-snapshot",
          source: { persistentVolumeClaimName: input.sourceClaim },
        },
      },
      {
        apiVersion: "v1",
        kind: "PersistentVolumeClaim",
        metadata,
        spec: {
          storageClassName: "mc-capture-fixture",
          accessModes: ["ReadWriteOnce"],
          resources: { requests: { storage: input.capacity } },
          dataSource: {
            name,
            kind: "VolumeSnapshot",
            apiGroup: "snapshot.storage.k8s.io",
          },
        },
      },
      {
        apiVersion: "v1",
        kind: "Pod",
        metadata,
        spec: {
          automountServiceAccountToken: false,
          imagePullSecrets: input.imagePullSecrets,
          restartPolicy: "Never",
          activeDeadlineSeconds: 900,
          securityContext: {
            runAsUser: 1000,
            runAsGroup: 2000,
            runAsNonRoot: true,
          },
          containers: [
            {
              name: "export",
              image: input.image,
              command: ["tail", "-f", "/dev/null"],
              securityContext: {
                allowPrivilegeEscalation: false,
                readOnlyRootFilesystem: true,
                capabilities: { drop: ["ALL"] },
              },
              resources: {
                requests: { cpu: "100m", memory: "128Mi" },
                limits: { cpu: "1", memory: "512Mi" },
              },
              volumeMounts: [
                { name: "fixture", mountPath: "/snapshot", readOnly: true },
              ],
            },
          ],
          volumes: [
            {
              name: "fixture",
              persistentVolumeClaim: { claimName: name, readOnly: true },
            },
          ],
        },
      },
    ],
  };
}

if (import.meta.main) {
  const value: unknown = await new Response(Bun.stdin.stream()).json();
  process.stdout.write(JSON.stringify(captureResources(value)));
}
