import { z } from "zod";
import type { Fetch } from "@shepherdjerred/ops-clients/http.ts";
import type { PrometheusClient } from "@shepherdjerred/ops-clients/prometheus.ts";
import type { TemporalFacet } from "@shepherdjerred/ops-model/facets.ts";
import type { ScheduleHealthObservation } from "#activities/ops/temporal-schedules-client.ts";
import { scheduleOutcome } from "#activities/ops/temporal-schedules.ts";

const FAILED_ACTION_STATUSES = new Set([
  "FAILED",
  "TIMED_OUT",
  "CANCELLED",
  "TERMINATED",
]);

const ROLE_TO_TASK_QUEUE: Readonly<Record<string, string>> = {
  workflows: "monorepo-workflows",
  workflow: "monorepo-workflows",
  infra: "infra",
  ops: "ops",
  repo: "repo-automation",
  reports: "reports",
  scout: "scout",
  home: "home",
  billing: "billing",
  streambot: "streambot",
  promotion: "storm-promotion",
  agent: "agent-task",
  "glitter-corpus": "glitter-corpus",
  "glitter-context": "glitter-context",
};

const K8sDeploymentListSchema = z.object({
  items: z
    .array(
      z.object({
        metadata: z.object({ name: z.string() }),
        spec: z
          .object({
            replicas: z.number().int().nonnegative().optional(),
            template: z
              .object({
                spec: z
                  .object({
                    containers: z
                      .array(
                        z.object({
                          env: z
                            .array(
                              z.object({
                                name: z.string(),
                                value: z.string().optional(),
                              }),
                            )
                            .optional(),
                        }),
                      )
                      .optional(),
                  })
                  .optional(),
              })
              .optional(),
          })
          .optional(),
        status: z
          .object({
            readyReplicas: z.number().int().nonnegative().optional(),
          })
          .optional(),
      }),
    )
    .default([]),
});

export type TemporalWorkerDeploymentInfo = {
  name: string;
  taskQueue: string;
  desiredReplicas: number;
  readyReplicas: number;
};

function inferTaskQueueFromDeployment(
  name: string,
  envVars: readonly { name: string; value?: string | undefined }[],
): string {
  const explicitQueue = envVars.find((e) => e.name === "TASK_QUEUE")?.value;
  if (explicitQueue !== undefined && explicitQueue !== "") {
    return explicitQueue;
  }
  const role = envVars.find((e) => e.name === "TEMPORAL_WORKER_ROLE")?.value;
  if (role !== undefined && role !== "") {
    return ROLE_TO_TASK_QUEUE[role] ?? role;
  }
  const stripped = name
    .replace(/^temporal-(?:temporal-)?/u, "")
    .replace(/-worker$/u, "");
  return ROLE_TO_TASK_QUEUE[stripped] ?? stripped;
}

export function parseTemporalWorkerDeployments(
  rawListJson: unknown,
): TemporalWorkerDeploymentInfo[] {
  const parsed = K8sDeploymentListSchema.safeParse(rawListJson);
  if (!parsed.success) {
    return [];
  }
  return parsed.data.items.flatMap((dep): TemporalWorkerDeploymentInfo[] => {
    const { name } = dep.metadata;
    if (!name.endsWith("-worker") || /-wf-retained-/iu.test(name)) {
      return [];
    }
    const envVars = dep.spec?.template?.spec?.containers?.[0]?.env ?? [];
    return [
      {
        name,
        taskQueue: inferTaskQueueFromDeployment(name, envVars),
        desiredReplicas: dep.spec?.replicas ?? 1,
        readyReplicas: dep.status?.readyReplicas ?? 0,
      },
    ];
  });
}

export async function fetchTemporalWorkerDeployments(input: {
  baseUrl: string;
  token: () => Promise<string>;
  fetchImpl: Fetch;
}): Promise<TemporalWorkerDeploymentInfo[]> {
  try {
    const url = new URL(
      "/apis/apps/v1/namespaces/temporal/deployments",
      input.baseUrl,
    );
    const response = await input.fetchImpl(url, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${await input.token()}`,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return [];
    }
    return parseTemporalWorkerDeployments(await response.json());
  } catch {
    return [];
  }
}

async function queryPollerMetrics(prometheus: PrometheusClient | undefined) {
  const pollers = new Map<string, number>();
  const slots = new Map<string, number>();
  if (prometheus === undefined) {
    return { pollers, slots };
  }
  const [pollersSettled, slotsSettled] = await Promise.allSettled([
    prometheus.query(
      "sum by (task_queue) (temporal_num_pollers)",
      AbortSignal.timeout(5000),
    ),
    prometheus.query(
      "sum by (task_queue) (temporal_worker_task_slots_available)",
      AbortSignal.timeout(5000),
    ),
  ]);
  if (pollersSettled.status === "fulfilled") {
    for (const s of pollersSettled.value) {
      const tq = s.metric["task_queue"] ?? "";
      if (tq !== "" && Number.isFinite(s.value)) {
        pollers.set(tq, Math.round(s.value));
      }
    }
  }
  if (slotsSettled.status === "fulfilled") {
    for (const s of slotsSettled.value) {
      const tq = s.metric["task_queue"] ?? "";
      if (tq !== "" && Number.isFinite(s.value)) {
        slots.set(tq, Math.round(s.value));
      }
    }
  }
  return { pollers, slots };
}

export async function buildTemporalFacet(input: {
  observations: readonly ScheduleHealthObservation[];
  workerDeployments?: readonly TemporalWorkerDeploymentInfo[];
  prometheus?: PrometheusClient;
  now: Date;
}): Promise<TemporalFacet> {
  const { pollers, slots } = await queryPollerMetrics(input.prometheus);

  const workerPools: TemporalFacet["workerPools"] = (
    input.workerDeployments ?? []
  )
    .filter(
      (dep) =>
        dep.name.endsWith("-worker") && !/-wf-retained-/iu.test(dep.name),
    )
    .map((dep) => ({
      deployment: dep.name,
      taskQueue: dep.taskQueue,
      readyReplicas: dep.readyReplicas,
      desiredReplicas: dep.desiredReplicas,
      pollers: pollers.get(dep.taskQueue) ?? null,
      slotsAvailable: slots.get(dep.taskQueue) ?? null,
    }))
    .sort((a, b) => a.deployment.localeCompare(b.deployment));

  let active = 0;
  let paused = 0;
  let failing = 0;

  const schedules: TemporalFacet["schedules"] = input.observations
    .map((obs) => {
      const outcome = scheduleOutcome(obs, input.now);
      let state = "active";
      if (obs.paused) {
        state = "paused";
        paused += 1;
      } else if (outcome.failed) {
        state = "failing";
        failing += 1;
      } else {
        active += 1;
        if (outcome.unknown) {
          state = "unknown";
        }
      }
      const recentFailures = obs.actions.filter((a) =>
        FAILED_ACTION_STATUSES.has(a.status),
      ).length;
      const latestAction = [...obs.actions].sort(
        (a, b) => Date.parse(b.scheduledAt) - Date.parse(a.scheduledAt),
      )[0];
      const lastRunAt =
        latestAction?.closedAt ??
        latestAction?.scheduledAt ??
        outcome.success?.closedAt ??
        outcome.success?.scheduledAt ??
        null;

      return {
        id: obs.scheduleId,
        state,
        recentFailures,
        lastRunAt,
        nextRunAt: obs.nextScheduledAt ?? null,
        taskQueue: obs.taskQueue,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    workerPools,
    scheduleSummary: {
      total: schedules.length,
      active,
      paused,
      failing,
    },
    schedules,
  };
}
