import { Client, type Connection } from "@temporalio/client";
import { z } from "zod";
import {
  WorkerPoolSnapshotSchema,
  WorkerRetirementClaimSchema,
  type WorkerVersion,
  type WorkerPoolSnapshot,
} from "@shepherdjerred/delivery/contract";

type Route = WorkerVersion["host"]["routes"][number];
type Routing = {
  currentBuildId: string;
  rampingBuildId: string | null;
  token: string;
};
export type WorkerRetirementEffects = {
  routing: (route: Route) => Promise<Routing>;
  version: (
    route: Route,
    buildId: string,
  ) => Promise<{
    buildId: string;
    lastDeactivationTime: string;
    checkedAt: string;
    status: "DRAINED" | "DRAINING" | "UNSPECIFIED";
  }>;
  openExecutions: (route: Route, buildId: string) => Promise<number>;
};

export async function requirePoolRoutingCoverage(
  pool: WorkerPoolSnapshot,
  read: WorkerRetirementEffects["routing"],
): Promise<void> {
  const host = pool.versions[0]?.host;
  if (host === undefined)
    throw new Error("Worker pool has no reviewed host profile");
  const live = new Set(
    pool.versions
      .filter((entry) => entry.replicas === 1)
      .map((entry) => entry.buildId),
  );
  for (const route of host.routes) {
    const routing = await read(route);
    if (
      !live.has(routing.currentBuildId) ||
      (routing.rampingBuildId !== null && !live.has(routing.rampingBuildId))
    )
      throw new Error(
        "Current or ramping routing lacks a live frozen retained host",
      );
  }
}

function requireUnrouted(routing: Routing, buildId: string) {
  if (routing.currentBuildId === buildId || routing.rampingBuildId === buildId)
    throw new Error("Retained worker still owns current or ramping routing");
  z.string()
    .regex(/^[a-f0-9]{40}$/u)
    .parse(routing.currentBuildId);
  if (routing.token.length === 0)
    throw new Error("Missing routing conflict token");
}

/** A drained flag alone omits later pinned overrides; exact visibility and routing readback are mandatory. */
export async function proveWorkerRetirement(
  raw: WorkerPoolSnapshot,
  workerId: string,
  effects: WorkerRetirementEffects,
  now = new Date(),
) {
  const pool = WorkerPoolSnapshotSchema.parse(raw);
  const worker = pool.versions.find((entry) => entry.id === workerId);
  if (worker === undefined || worker.buildId === pool.candidateBuildId)
    throw new Error(
      "Retirement target is missing or remains the accepted candidate",
    );
  const proofs = [];
  for (const route of worker.host.routes) {
    const before = await effects.routing(route);
    requireUnrouted(before, worker.buildId);
    const version = await effects.version(route, worker.buildId);
    const deactivated = Date.parse(version.lastDeactivationTime);
    const checked = Date.parse(version.checkedAt);
    if (
      version.buildId !== worker.buildId ||
      version.status !== "DRAINED" ||
      !Number.isFinite(deactivated) ||
      !Number.isFinite(checked) ||
      checked < deactivated ||
      checked > now.getTime() ||
      deactivated > now.getTime()
    )
      throw new Error(
        "Worker drainage does not prove this deactivation has drained",
      );
    const count = await effects.openExecutions(route, worker.buildId);
    if (count !== 0)
      throw new Error("Retained worker still has open pinned executions");
    const after = await effects.routing(route);
    requireUnrouted(after, worker.buildId);
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw new Error("Worker routing changed during retirement inspection");
    proofs.push({
      ...route,
      observedAt: now.toISOString(),
      currentBuildId: after.currentBuildId,
      rampingBuildId: after.rampingBuildId,
      openExecutions: 0,
      drainageStatus: "DRAINED",
      deactivationObservedAt: now.toISOString(),
      lastDeactivationTime: version.lastDeactivationTime,
      lastCheckedTime: version.checkedAt,
      routingConflictToken: after.token,
      // No open execution includes canaries and explicitly pinned candidates.
      candidateReferences: 0,
      canaryReferences: 0,
    });
  }
  return WorkerRetirementClaimSchema.parse({ proofs });
}

type Timestamp =
  | {
      seconds?: { toString: () => string } | number | null;
      nanos?: number | null;
    }
  | null
  | undefined;
function timestamp(value: Timestamp): string {
  if (value?.seconds === undefined || value.seconds === null)
    throw new Error("Temporal omitted required drainage timestamp");
  return new Date(
    Number(value.seconds.toString()) * 1000 + (value.nanos ?? 0) / 1_000_000,
  ).toISOString();
}

/** Server 1.32 uses colon search attributes; deprecated version strings use dot. Check both plus pinned overrides. */
export function workerOpenExecutionQuery(
  route: Route,
  buildId: string,
): string {
  z.string()
    .regex(/^[a-f0-9]{40}$/u)
    .parse(buildId);
  z.string()
    .regex(/^[a-z0-9-]+$/u)
    .parse(route.deploymentName);
  const version = `${route.deploymentName}:${buildId}`;
  const legacy = `${route.deploymentName}.${buildId}`;
  return `ExecutionStatus = 'Running' AND (TemporalWorkerDeploymentVersion IN ('${version}', '${legacy}') OR TemporalUsedWorkerDeploymentVersions IN ('${version}', '${legacy}') OR BuildIds IN ('versioned:${buildId}', 'pinned:${version}', 'pinned:${legacy}'))`;
}

export function retirementEffects(
  connection: Connection,
): WorkerRetirementEffects {
  const service = connection.workflowService;
  return {
    async routing(route) {
      const result = await service.describeWorkerDeployment({
        namespace: route.namespace,
        deploymentName: route.deploymentName,
      });
      const info = result.workerDeploymentInfo;
      if (
        info?.name !== route.deploymentName ||
        info.routingConfig === undefined ||
        info.routingConfig === null
      )
        throw new Error("Temporal returned another worker deployment");
      const routing = info.routingConfig;
      return {
        currentBuildId: routing.currentDeploymentVersion?.buildId ?? "",
        rampingBuildId: routing.rampingDeploymentVersion?.buildId ?? null,
        token: Buffer.from(result.conflictToken).toString("base64"),
      };
    },
    async version(route, buildId) {
      const result = await service.describeWorkerDeploymentVersion({
        namespace: route.namespace,
        deploymentVersion: { deploymentName: route.deploymentName, buildId },
      });
      const version = result.workerDeploymentVersionInfo;
      if (version?.deploymentVersion?.deploymentName !== route.deploymentName)
        throw new Error("Temporal returned another worker version");
      return {
        buildId: version.deploymentVersion.buildId ?? "",
        lastDeactivationTime: timestamp(version.lastDeactivationTime),
        checkedAt: timestamp(version.drainageInfo?.lastCheckedTime),
        status:
          Number(version.drainageInfo?.status) === 2
            ? "DRAINED"
            : Number(version.drainageInfo?.status) === 1
              ? "DRAINING"
              : "UNSPECIFIED",
      };
    },
    async openExecutions(route, buildId) {
      const client = new Client({ connection, namespace: route.namespace });
      const result = await client.workflow.count(
        workerOpenExecutionQuery(route, buildId),
      );
      return result.count;
    },
  };
}
