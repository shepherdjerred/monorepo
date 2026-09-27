import { Context } from "@temporalio/activity";
import {
  commandFailure,
  kubectl,
  readOptional,
  run,
  type Command,
} from "./mining-reset-kubectl.ts";
import {
  assertCompletedBackup,
  assertExactlyOneBackedUpClaim,
  assertMatchingResetJob,
  BackupSchema,
  JobSchema,
  MINING_CLAIM,
  MINING_LOCK_ANNOTATION,
  MINING_NAMESPACE,
  MINING_SERVER,
  MiningPeriodSchema,
  miningBackupName,
  miningResetScript,
  PodListSchema,
  PvcListSchema,
  ROUTER_WAKE_ANNOTATION,
  ServiceSchema,
  StatefulSetSchema,
} from "./mining-reset-contract.ts";

async function readServer(command: Command) {
  return StatefulSetSchema.parse(
    JSON.parse(
      await run(command, [
        "-n",
        MINING_NAMESPACE,
        "get",
        "statefulset",
        MINING_SERVER,
        "-o",
        "json",
      ]),
    ),
  );
}

async function readService(command: Command) {
  return ServiceSchema.parse(
    JSON.parse(
      await run(command, [
        "-n",
        MINING_NAMESPACE,
        "get",
        "service",
        MINING_SERVER,
        "-o",
        "json",
      ]),
    ),
  );
}

async function patchJson(
  command: Command,
  kind: "statefulset" | "service",
  patch: readonly object[],
): Promise<void> {
  await run(command, [
    "-n",
    MINING_NAMESPACE,
    "patch",
    kind,
    MINING_SERVER,
    "--type=json",
    "-p",
    JSON.stringify(patch),
  ]);
}

function annotationPath(key: string): string {
  return `/metadata/annotations/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
}

function resetImage(server: Awaited<ReturnType<typeof readServer>>): string {
  if (server.spec.template.spec.containers.length !== 1) {
    throw new Error(
      "Expected one The Storm server container for the reset Job image",
    );
  }
  const image = server.spec.template.spec.containers[0]?.image;
  if (image === undefined || image.length === 0) {
    throw new Error("The Storm server image is missing");
  }
  return image;
}

function assertWakePrecondition(
  service: Awaited<ReturnType<typeof readService>>,
  heldBy: string | undefined,
): void {
  const wake = service.metadata.annotations?.[ROUTER_WAKE_ANNOTATION];
  if (wake !== undefined && (wake !== "false" || heldBy === undefined)) {
    throw new Error(`Unexpected mc-router autoScaleUp annotation: ${wake}`);
  }
  if (service.metadata.resourceVersion === undefined) {
    throw new Error("The Storm Service has no resourceVersion");
  }
}

async function disableRouterWake(
  command: Command,
  service: Awaited<ReturnType<typeof readService>>,
): Promise<void> {
  if (service.metadata.annotations?.[ROUTER_WAKE_ANNOTATION] !== undefined) {
    return;
  }
  await patchJson(command, "service", [
    {
      op: "test",
      path: "/metadata/resourceVersion",
      value: service.metadata.resourceVersion,
    },
    ...(service.metadata.annotations === undefined
      ? [
          {
            op: "add",
            path: "/metadata/annotations",
            value: { [ROUTER_WAKE_ANNOTATION]: "false" },
          },
        ]
      : [
          {
            op: "add",
            path: annotationPath(ROUTER_WAKE_ANNOTATION),
            value: "false",
          },
        ]),
  ]);
}

async function acquireLock(command: Command, period: string): Promise<string> {
  const server = await readServer(command);
  const heldBy = server.metadata.annotations?.[MINING_LOCK_ANNOTATION];
  if (heldBy !== undefined && heldBy !== period) {
    throw new Error(`Mining reset maintenance lock belongs to ${heldBy}`);
  }
  if (server.spec.replicas !== 0 || (server.status?.replicas ?? 0) !== 0) {
    throw new Error("The Storm server is running; defer the mining reset");
  }
  const image = resetImage(server);
  if (server.metadata.resourceVersion === undefined) {
    throw new Error("The Storm StatefulSet has no resourceVersion");
  }
  const service = await readService(command);
  assertWakePrecondition(service, heldBy);
  if (heldBy === undefined) {
    const annotations = server.metadata.annotations;
    await patchJson(command, "statefulset", [
      {
        op: "test",
        path: "/metadata/resourceVersion",
        value: server.metadata.resourceVersion,
      },
      { op: "test", path: "/spec/replicas", value: 0 },
      ...(annotations === undefined
        ? [
            {
              op: "add",
              path: "/metadata/annotations",
              value: { [MINING_LOCK_ANNOTATION]: period },
            },
          ]
        : [
            {
              op: "add",
              path: annotationPath(MINING_LOCK_ANNOTATION),
              value: period,
            },
          ]),
    ]);
  }

  // The admission policy guards the StatefulSet immediately. The Service
  // annotation also stops mc-router from attempting a wake after its watch
  // observes the update. Preserve a pre-existing opt-out by refusing it.
  await disableRouterWake(command, service);
  return image;
}

async function assertStoppedAndBackedUpClaim(
  command: Command,
  period: string,
  allowResetJob: boolean,
): Promise<void> {
  const server = await readServer(command);
  if (
    server.metadata.annotations?.[MINING_LOCK_ANNOTATION] !== period ||
    server.spec.replicas !== 0 ||
    (server.status?.replicas ?? 0) !== 0
  ) {
    throw new Error("The Storm server is not locked at zero replicas");
  }
  const pods = PodListSchema.parse(
    JSON.parse(
      await run(command, ["-n", MINING_NAMESPACE, "get", "pods", "-o", "json"]),
    ),
  );
  if (
    pods.items.some(
      (pod) =>
        !allowResetJob ||
        pod.metadata.labels?.["sjer.red/mining-reset-period"] !== period ||
        pod.metadata.ownerReferences?.length !== 1 ||
        pod.metadata.ownerReferences[0]?.kind !== "Job" ||
        pod.metadata.ownerReferences[0].name !== miningBackupName(period),
    )
  ) {
    throw new Error(
      "The Storm namespace has a Pod outside the current reset Job",
    );
  }
  const claims = PvcListSchema.parse(
    JSON.parse(
      await run(command, [
        "-n",
        MINING_NAMESPACE,
        "get",
        "pvc",
        "-l",
        "velero.io/backup=enabled",
        "-o",
        "json",
      ]),
    ),
  );
  assertExactlyOneBackedUpClaim(claims);
}

function backupManifest(period: string): string {
  return JSON.stringify({
    apiVersion: "velero.io/v1",
    kind: "Backup",
    metadata: {
      name: miningBackupName(period),
      namespace: "velero",
      labels: { "sjer.red/mining-reset-period": period },
    },
    spec: {
      includedNamespaces: [MINING_NAMESPACE],
      labelSelector: { matchLabels: { "velero.io/backup": "enabled" } },
      snapshotVolumes: true,
      storageLocation: "default",
      ttl: "2160h",
    },
  });
}

async function ensureBackup(
  command: Command,
  period: string,
): Promise<boolean> {
  const args = [
    "-n",
    "velero",
    "get",
    "backup",
    miningBackupName(period),
    "-o",
    "json",
  ];
  let raw = await readOptional(command, args);
  if (raw === undefined) {
    const result = await command(["create", "-f", "-"], backupManifest(period));
    if (result.exitCode !== 0 && !result.stderr.includes("AlreadyExists")) {
      throw commandFailure(["create", "-f", "-"], result);
    }
    raw = await run(command, args);
  }
  return assertCompletedBackup(BackupSchema.parse(JSON.parse(raw)), period);
}

function resetJobManifest(period: string, image: string): string {
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

async function ensureResetJob(
  command: Command,
  period: string,
  image: string,
): Promise<boolean> {
  const args = [
    "-n",
    MINING_NAMESPACE,
    "get",
    "job",
    miningBackupName(period),
    "-o",
    "json",
  ];
  let raw = await readOptional(command, args);
  if (raw === undefined) {
    const result = await command(
      ["create", "-f", "-"],
      resetJobManifest(period, image),
    );
    if (result.exitCode !== 0 && !result.stderr.includes("AlreadyExists")) {
      throw commandFailure(["create", "-f", "-"], result);
    }
    raw = await run(command, args);
  }
  return assertMatchingResetJob(
    JobSchema.parse(JSON.parse(raw)),
    period,
    image,
  );
}

async function releaseLock(command: Command, period: string): Promise<void> {
  const server = await readServer(command);
  if (server.metadata.annotations?.[MINING_LOCK_ANNOTATION] !== period) {
    throw new Error(
      "Refusing to release a mining reset lock owned by another run",
    );
  }
  if (server.spec.replicas !== 0) {
    throw new Error(
      "Refusing to release mining reset lock while server is running",
    );
  }
  const service = await readService(command);
  if (service.metadata.annotations?.[ROUTER_WAKE_ANNOTATION] !== "false") {
    throw new Error("mc-router maintenance annotation changed before release");
  }
  await patchJson(command, "service", [
    {
      op: "test",
      path: annotationPath(ROUTER_WAKE_ANNOTATION),
      value: "false",
    },
    { op: "remove", path: annotationPath(ROUTER_WAKE_ANNOTATION) },
  ]);
  await patchJson(command, "statefulset", [
    { op: "test", path: annotationPath(MINING_LOCK_ANNOTATION), value: period },
    { op: "remove", path: annotationPath(MINING_LOCK_ANNOTATION) },
  ]);
}

type MiningResetDependencies = {
  command: Command;
  heartbeat: (phase: string) => void;
  sleep: (milliseconds: number) => Promise<void>;
};

export async function resetMiningWorldWithDependencies(
  periodInput: string,
  dependencies: MiningResetDependencies,
): Promise<string> {
  const period = MiningPeriodSchema.parse(periodInput);
  const image = await acquireLock(dependencies.command, period);
  dependencies.heartbeat("locked");

  // The on-demand backup is named by quarter. A retry observes the same CR,
  // never creates another snapshot with an ambiguous recovery point.
  for (let attempt = 0; attempt < 240; attempt += 1) {
    dependencies.heartbeat("backup");
    // On a retry after the Job was created, a completed backup remains the
    // durable checkpoint. The backup phase never tolerates a mounted Pod while
    // its snapshot is still in progress.
    const alreadyCompleted = await readOptional(dependencies.command, [
      "-n",
      "velero",
      "get",
      "backup",
      miningBackupName(period),
      "-o",
      "json",
    ]);
    const backupComplete =
      alreadyCompleted !== undefined &&
      assertCompletedBackup(
        BackupSchema.parse(JSON.parse(alreadyCompleted)),
        period,
      );
    await assertStoppedAndBackedUpClaim(
      dependencies.command,
      period,
      backupComplete,
    );
    if (await ensureBackup(dependencies.command, period)) {
      break;
    }
    if (attempt === 239) {
      throw new Error("Mining reset backup did not complete within two hours");
    }
    await dependencies.sleep(30_000);
  }

  for (let attempt = 0; attempt < 60; attempt += 1) {
    dependencies.heartbeat("job");
    await assertStoppedAndBackedUpClaim(dependencies.command, period, true);
    if (await ensureResetJob(dependencies.command, period, image)) {
      await releaseLock(dependencies.command, period);
      return `Mining world reset ${period} after a completed Velero snapshot`;
    }
    if (attempt === 59) {
      throw new Error("Mining reset Job did not finish within 30 minutes");
    }
    await dependencies.sleep(30_000);
  }
  throw new Error("Mining reset Job loop exited unexpectedly");
}

export type MiningResetActivities = typeof miningResetActivities;
export const miningResetActivities = {
  async resetMiningWorld(period: string): Promise<string> {
    return resetMiningWorldWithDependencies(period, {
      command: kubectl,
      heartbeat: (phase) => {
        Context.current().heartbeat({ period, phase });
      },
      sleep: Bun.sleep,
    });
  },
};
