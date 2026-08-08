import { Context } from "@temporalio/activity";
import { z } from "zod/v4";
import {
  kubernetesMaintenanceLastSuccessTimestampSeconds,
  kubernetesMaintenanceRunsTotal,
} from "#observability/metrics.ts";

const JOB_NAMESPACE = {
  KOMETA: "media",
  BUILDKITE: "buildkite",
} as const;

const JOB_NAME_PREFIX = {
  KOMETA: "temporal-kometa",
  BUN_CACHE_GC: "temporal-bun-cache-gc",
  UV_CACHE_PRUNE: "temporal-uv-cache-prune",
  TRIVY_DB_REFRESH: "temporal-trivy-db-refresh",
} as const;

const JobStatusSchema = z.object({
  status: z
    .object({
      succeeded: z.number().optional(),
      failed: z.number().optional(),
      conditions: z
        .array(
          z.object({
            type: z.string(),
            reason: z.string().optional(),
            message: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

type MaintenanceJob = {
  kind: string;
  namespace: string;
  name: string;
  body: Record<string, unknown>;
  activeDeadlineSeconds: number;
};

type KubectlResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

function requiredEnvironment(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required for Temporal Kubernetes maintenance`);
  }
  return value;
}

function workflowRunId(): string {
  const execution = Context.current().info.workflowExecution;
  if (execution === undefined) {
    throw new Error(
      "Kubernetes maintenance requires a Temporal workflow execution",
    );
  }
  return execution.runId;
}

function jobName(prefix: string): string {
  return `${prefix}-${workflowRunId().replaceAll("-", "").slice(0, 20)}`;
}

async function runKubectl(
  args: string[],
  input?: string,
): Promise<KubectlResult> {
  const process = Bun.spawn(["kubectl", ...args], {
    stdin: input === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (input !== undefined) {
    const stdin = process.stdin;
    if (stdin === undefined) {
      throw new Error("kubectl stdin pipe was not created");
    }
    await stdin.write(input);
    await stdin.end();
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { stdout, stderr, exitCode };
}

async function readJob(
  job: MaintenanceJob,
): Promise<z.infer<typeof JobStatusSchema> | undefined> {
  const result = await runKubectl([
    "get",
    "job",
    job.name,
    "--namespace",
    job.namespace,
    "--output",
    "json",
  ]);
  if (result.exitCode !== 0) {
    if (result.stderr.toLowerCase().includes("not found")) {
      return undefined;
    }
    throw new Error(
      `kubectl get job ${job.name} failed: ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
  return JobStatusSchema.parse(JSON.parse(result.stdout) as unknown);
}

async function deleteJob(job: MaintenanceJob): Promise<void> {
  const result = await runKubectl([
    "delete",
    "job",
    job.name,
    "--namespace",
    job.namespace,
    "--wait=true",
  ]);
  if (
    result.exitCode !== 0 &&
    !result.stderr.toLowerCase().includes("not found")
  ) {
    throw new Error(
      `kubectl delete job ${job.name} failed: ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
}

async function createJob(job: MaintenanceJob): Promise<void> {
  const body = {
    ...job.body,
    metadata: {
      name: job.name,
      namespace: job.namespace,
      labels: {
        "app.kubernetes.io/managed-by": "temporal",
        "temporal.sjer.red/maintenance": job.kind,
      },
    },
  };
  const result = await runKubectl(
    ["create", "--namespace", job.namespace, "--filename", "-"],
    JSON.stringify(body),
  );
  if (result.exitCode !== 0) {
    if (result.stderr.toLowerCase().includes("already exists")) {
      return;
    }
    throw new Error(
      `kubectl create job ${job.name} failed: ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
}

async function waitForJob(job: MaintenanceJob): Promise<void> {
  const deadline = Date.now() + job.activeDeadlineSeconds * 1000;
  while (Date.now() < deadline) {
    Context.current().heartbeat({ job: job.name, phase: "wait" });
    const status = await readJob(job);
    if (status === undefined) {
      await Bun.sleep(2000);
      continue;
    }
    if ((status.status?.succeeded ?? 0) > 0) {
      return;
    }
    if ((status.status?.failed ?? 0) > 0) {
      const condition = status.status?.conditions?.find(
        (candidate) => candidate.type === "Failed",
      );
      throw new Error(
        `Kubernetes maintenance job ${job.name} failed: ${condition?.reason ?? "unknown"} ${condition?.message ?? ""}`.trim(),
      );
    }
    await Bun.sleep(5000);
  }
  throw new Error(
    `Kubernetes maintenance job ${job.name} exceeded its active deadline`,
  );
}

function buildJob(definition: {
  kind: string;
  namespace: string;
  name: string;
  podSpec: Record<string, unknown>;
  activeDeadlineSeconds: number;
}): MaintenanceJob {
  return {
    kind: definition.kind,
    namespace: definition.namespace,
    name: definition.name,
    activeDeadlineSeconds: definition.activeDeadlineSeconds,
    body: {
      apiVersion: "batch/v1",
      kind: "Job",
      spec: {
        backoffLimit: 0,
        activeDeadlineSeconds: definition.activeDeadlineSeconds,
        ttlSecondsAfterFinished: 3600,
        template: {
          metadata: {
            labels: {
              "app.kubernetes.io/managed-by": "temporal",
              "temporal.sjer.red/maintenance": definition.kind,
            },
          },
          spec: definition.podSpec,
        },
      },
    },
  };
}

function buildKometaJob(): MaintenanceJob {
  return buildJob({
    kind: "kometa",
    namespace: JOB_NAMESPACE.KOMETA,
    name: jobName(JOB_NAME_PREFIX.KOMETA),
    podSpec: {
      restartPolicy: "Never",
      securityContext: {
        runAsUser: 1000,
        runAsGroup: 1000,
        runAsNonRoot: true,
        fsGroup: 1000,
        fsGroupChangePolicy: "OnRootMismatch",
        seccompProfile: { type: "RuntimeDefault" },
      },
      containers: [
        {
          name: "kometa",
          image: requiredEnvironment("TEMPORAL_MAINTENANCE_KOMETA_IMAGE"),
          args: ["--run"],
          env: [
            { name: "TZ", value: "America/Los_Angeles" },
            { name: "KOMETA_READ_ONLY_CONFIG", value: "true" },
            {
              name: "KOMETA_PLEXTOKEN",
              valueFrom: {
                secretKeyRef: { name: "kometa-plex-secrets", key: "password" },
              },
            },
            {
              name: "KOMETA_TMDBAPIKEY",
              valueFrom: {
                secretKeyRef: {
                  name: "kometa-credentials",
                  key: "TMDB_API_KEY",
                },
              },
            },
          ],
          resources: {
            requests: { cpu: "50m", memory: "256Mi" },
            limits: { cpu: "1000m", memory: "1Gi" },
          },
          securityContext: {
            runAsUser: 1000,
            runAsGroup: 1000,
            runAsNonRoot: true,
            allowPrivilegeEscalation: false,
            readOnlyRootFilesystem: false,
            capabilities: { drop: ["ALL"] },
          },
          volumeMounts: [
            { name: "kometa-workdir", mountPath: "/config" },
            {
              name: "kometa-config",
              mountPath: "/config/config.yml",
              subPath: "config.yml",
              readOnly: true,
            },
          ],
        },
      ],
      volumes: [
        { name: "kometa-workdir", emptyDir: {} },
        {
          name: "kometa-config",
          configMap: {
            name: "kometa-config",
            items: [{ key: "config.yml", path: "config.yml" }],
          },
        },
      ],
    },
    activeDeadlineSeconds: 1800,
  });
}

function buildBuildkiteJob(definition: {
  kind: string;
  prefix: string;
  container: Record<string, unknown>;
  volumes: Record<string, unknown>[];
  activeDeadlineSeconds: number;
}): MaintenanceJob {
  return buildJob({
    kind: definition.kind,
    namespace: JOB_NAMESPACE.BUILDKITE,
    name: jobName(definition.prefix),
    activeDeadlineSeconds: definition.activeDeadlineSeconds,
    podSpec: {
      restartPolicy: "Never",
      nodeSelector: { "kubernetes.io/hostname": "liskov" },
      tolerations: [
        { key: "ci", operator: "Equal", value: "only", effect: "NoSchedule" },
      ],
      containers: [definition.container],
      volumes: definition.volumes,
    },
  });
}

function buildBunCacheGcJob(): MaintenanceJob {
  return buildBuildkiteJob({
    kind: "buildkite-bun-cache-gc",
    prefix: JOB_NAME_PREFIX.BUN_CACHE_GC,
    container: {
      name: "bun-cache-gc",
      image: requiredEnvironment("TEMPORAL_MAINTENANCE_CI_BASE_IMAGE"),
      imagePullPolicy: "IfNotPresent",
      command: ["bash", "/buildkite/maintenance/bun-cache-gc.sh"],
      env: [
        { name: "BUN_INSTALL_CACHE_DIR", value: "/buildkite/bun-cache/data" },
        {
          name: "BUN_CACHE_LOCK_FILE",
          value: "/buildkite/bun-cache-control/.gc.lock",
        },
        { name: "BUN_CACHE_GC_THRESHOLD_PERCENT", value: "60" },
      ],
      resources: {
        requests: { cpu: "50m", memory: "128Mi" },
        limits: { cpu: "500m", memory: "512Mi" },
      },
      volumeMounts: [
        { name: "bun-cache", mountPath: "/buildkite/bun-cache" },
        {
          name: "bun-cache-control",
          mountPath: "/buildkite/bun-cache-control",
        },
        {
          name: "bun-cache-gc-script",
          mountPath: "/buildkite/maintenance",
          readOnly: true,
        },
      ],
    },
    volumes: [
      {
        name: "bun-cache",
        persistentVolumeClaim: { claimName: "buildkite-bun-cache" },
      },
      {
        name: "bun-cache-control",
        persistentVolumeClaim: { claimName: "buildkite-bun-cache-control" },
      },
      {
        name: "bun-cache-gc-script",
        configMap: { name: "buildkite-bun-cache-gc", defaultMode: 365 },
      },
    ],
    activeDeadlineSeconds: 900,
  });
}

function buildUvCachePruneJob(): MaintenanceJob {
  return buildBuildkiteJob({
    kind: "buildkite-uv-cache-prune",
    prefix: JOB_NAME_PREFIX.UV_CACHE_PRUNE,
    container: {
      name: "uv-cache-prune",
      image: requiredEnvironment("TEMPORAL_MAINTENANCE_CI_BASE_IMAGE"),
      imagePullPolicy: "IfNotPresent",
      command: ["uv", "cache", "prune", "--ci"],
      env: [{ name: "UV_CACHE_DIR", value: "/buildkite/uv-cache" }],
      resources: {
        requests: { cpu: "50m", memory: "128Mi" },
        limits: { cpu: "500m", memory: "512Mi" },
      },
      volumeMounts: [{ name: "uv-cache", mountPath: "/buildkite/uv-cache" }],
    },
    volumes: [
      {
        name: "uv-cache",
        persistentVolumeClaim: { claimName: "buildkite-uv-cache" },
      },
    ],
    activeDeadlineSeconds: 1800,
  });
}

function buildTrivyDbRefreshJob(): MaintenanceJob {
  return buildBuildkiteJob({
    kind: "buildkite-trivy-db-refresh",
    prefix: JOB_NAME_PREFIX.TRIVY_DB_REFRESH,
    container: {
      name: "trivy-db-refresh",
      image: requiredEnvironment("TEMPORAL_MAINTENANCE_TRIVY_IMAGE"),
      command: ["trivy"],
      args: [
        "image",
        "--download-db-only",
        "--cache-dir",
        "/buildkite/trivy-db",
      ],
      resources: {
        requests: { cpu: "50m", memory: "256Mi" },
        limits: { cpu: "500m", memory: "1Gi" },
      },
      volumeMounts: [{ name: "trivy-db", mountPath: "/buildkite/trivy-db" }],
    },
    volumes: [
      {
        name: "trivy-db",
        persistentVolumeClaim: { claimName: "buildkite-trivy-db" },
      },
    ],
    activeDeadlineSeconds: 1800,
  });
}

async function runMaintenanceJob(job: MaintenanceJob): Promise<void> {
  const existing = await readJob(job);
  if (
    existing?.status?.succeeded !== undefined &&
    existing.status.succeeded > 0
  ) {
    kubernetesMaintenanceLastSuccessTimestampSeconds.set(
      { job: job.kind },
      Date.now() / 1000,
    );
    kubernetesMaintenanceRunsTotal.inc({ job: job.kind, outcome: "success" });
    return;
  }
  if (existing?.status?.failed !== undefined && existing.status.failed > 0) {
    await deleteJob(job);
  }
  try {
    await createJob(job);
    await waitForJob(job);
    kubernetesMaintenanceLastSuccessTimestampSeconds.set(
      { job: job.kind },
      Date.now() / 1000,
    );
    kubernetesMaintenanceRunsTotal.inc({ job: job.kind, outcome: "success" });
  } catch (error: unknown) {
    kubernetesMaintenanceRunsTotal.inc({ job: job.kind, outcome: "failure" });
    throw error;
  }
}

export type KubernetesMaintenanceActivities =
  typeof kubernetesMaintenanceActivities;

export const kubernetesMaintenanceActivities = {
  async runKometa(): Promise<void> {
    await runMaintenanceJob(buildKometaJob());
  },
  async runBunCacheGc(): Promise<void> {
    await runMaintenanceJob(buildBunCacheGcJob());
  },
  async runUvCachePrune(): Promise<void> {
    await runMaintenanceJob(buildUvCachePruneJob());
  },
  async runTrivyDbRefresh(): Promise<void> {
    await runMaintenanceJob(buildTrivyDbRefreshJob());
  },
};
