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
type InactiveVersion = {
  buildId: string;
  status: "INACTIVE";
  versionCreatedAt: string;
  firstActivationTime: null;
  lastCurrentTime: null;
  lastDeactivationTime: null;
  currentSinceTime: null;
  rampingSinceTime: null;
  routingChangedTime: null;
};
export type WorkerRetirementEffects = {
  routing: (route: Route) => Promise<Routing>;
  version: (
    route: Route,
    buildId: string,
  ) => Promise<
    | InactiveVersion
    | {
        buildId: string;
        lastDeactivationTime: string;
        checkedAt: string;
        status: "DRAINED" | "DRAINING" | "UNSPECIFIED";
      }
  >;
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
    if (version.buildId !== worker.buildId)
      throw new Error("Temporal returned another worker version");
    if (version.status !== "INACTIVE") requireDrained(version, now);
    const count = await effects.openExecutions(route, worker.buildId);
    if (count !== 0)
      throw new Error("Retained worker still has open pinned executions");
    if (version.status === "INACTIVE")
      await recheckInactive(route, worker.buildId, version, effects);
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
      ...(version.status === "INACTIVE"
        ? {
            proofKind: "inactive-unreferenced",
            versionStatus: version.status,
            versionCreatedAt: version.versionCreatedAt,
            firstActivationTime: version.firstActivationTime,
            lastCurrentTime: version.lastCurrentTime,
            lastDeactivationTime: version.lastDeactivationTime,
            currentSinceTime: version.currentSinceTime,
            rampingSinceTime: version.rampingSinceTime,
            routingChangedTime: version.routingChangedTime,
          }
        : {
            drainageStatus: "DRAINED",
            deactivationObservedAt: now.toISOString(),
            lastDeactivationTime: version.lastDeactivationTime,
            lastCheckedTime: version.checkedAt,
          }),
      routingConflictToken: after.token,
      // No open execution includes canaries and explicitly pinned candidates.
      candidateReferences: 0,
      canaryReferences: 0,
    });
  }
  return WorkerRetirementClaimSchema.parse({ proofs });
}

async function recheckInactive(
  route: Route,
  buildId: string,
  version: InactiveVersion,
  effects: WorkerRetirementEffects,
) {
  const repeated = await effects.version(route, buildId);
  if (
    JSON.stringify(repeated) !== JSON.stringify(version) ||
    (await effects.openExecutions(route, buildId)) !== 0
  )
    throw new Error(
      "Inactive worker changed or gained pinned executions during retirement inspection",
    );
}

function requireDrained(
  version: Exclude<
    Awaited<ReturnType<WorkerRetirementEffects["version"]>>,
    InactiveVersion
  >,
  now: Date,
) {
  const deactivated = Date.parse(version.lastDeactivationTime);
  const checked = Date.parse(version.checkedAt);
  if (
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

type NativeVersion = {
  deploymentVersion?: {
    deploymentName?: string | null;
    buildId?: string | null;
  } | null;
  status?: number | null;
  createTime?: Timestamp;
  firstActivationTime?: Timestamp;
  lastCurrentTime?: Timestamp;
  lastDeactivationTime?: Timestamp;
  currentSinceTime?: Timestamp;
  rampingSinceTime?: Timestamp;
  routingChangedTime?: Timestamp;
  drainageInfo?: unknown;
};

/** Prove this current INACTIVE incarnation, without claiming lifetime history. */
export function inactiveWorkerVersion(
  version: NativeVersion,
  expected: { deploymentName: string; buildId: string },
): InactiveVersion {
  if (
    version.deploymentVersion?.deploymentName !== expected.deploymentName ||
    version.deploymentVersion.buildId !== expected.buildId ||
    Number(version.status) !== 1
  )
    throw new Error(
      "Temporal did not return the exact INACTIVE worker version",
    );
  if (
    [
      version.firstActivationTime,
      version.lastCurrentTime,
      version.lastDeactivationTime,
      version.currentSinceTime,
      version.rampingSinceTime,
      version.routingChangedTime,
      version.drainageInfo,
    ].some((value) => value !== undefined && value !== null)
  )
    throw new Error("Inactive worker retains activation or drainage history");
  return {
    buildId: expected.buildId,
    status: "INACTIVE",
    versionCreatedAt: timestamp(version.createTime),
    firstActivationTime: null,
    lastCurrentTime: null,
    lastDeactivationTime: null,
    currentSinceTime: null,
    rampingSinceTime: null,
    routingChangedTime: null,
  };
}

/** Historical use does not pin AutoUpgrade workflows; retain all other reference forms fail-closed. */
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
  return `ExecutionStatus = 'Running' AND (TemporalWorkerDeploymentVersion IN ('${version}', '${legacy}') OR TemporalUsedWorkerDeploymentVersions IN ('${version}', '${legacy}') OR BuildIds IN ('versioned:${buildId}', 'pinned:${version}', 'pinned:${legacy}')) AND (TemporalWorkflowVersioningBehavior != 'AutoUpgrade' OR TemporalWorkflowVersioningBehavior IS NULL)`;
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
      if (version.deploymentVersion.buildId !== buildId)
        throw new Error("Temporal returned another worker build");
      // WorkerDeploymentVersionStatus.INACTIVE (installed Temporal SDK enum).
      if (Number(version.status) === 1)
        return inactiveWorkerVersion(version, {
          deploymentName: route.deploymentName,
          buildId,
        });
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
