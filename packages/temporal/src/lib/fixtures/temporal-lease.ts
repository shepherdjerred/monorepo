import { spawnSync } from "node:child_process";
import { env } from "node:process";
import {
  type LocalTestWorkflowEnvironmentOptions,
  TestWorkflowEnvironment,
  type TimeSkippingTestWorkflowEnvironmentOptions,
} from "@temporalio/testing";
import {
  acquireTemporalTendLease,
  type TemporalTendLeaseHandle,
} from "@shepherdjerred/root-scripts/lib/temporal/temporal-tend-lease.ts";

const leasedEnvironments = new WeakMap<
  TestWorkflowEnvironment,
  Promise<TemporalTendLeaseHandle>
>();
const activeEnvironments = new Set<TestWorkflowEnvironment>();
const installedTargets = new WeakSet<object>();

export function attachTemporalEnvironmentLease(
  environment: TestWorkflowEnvironment,
  options: { ttlMs?: number; tendDir?: string } = {},
): Promise<TemporalTendLeaseHandle> {
  activeEnvironments.add(environment);
  const existing = leasedEnvironments.get(environment);
  if (existing !== undefined) {
    return existing;
  }
  const created = acquireTemporalTendLease(environment.address, options);
  leasedEnvironments.set(environment, created);

  const originalTeardown = environment.teardown.bind(environment);
  environment.teardown = async (): Promise<void> => {
    try {
      await originalTeardown();
    } finally {
      activeEnvironments.delete(environment);
      const lease = await created.catch(() => null);
      await lease?.release();
    }
  };

  return created;
}

export async function teardownActiveTemporalEnvironments(): Promise<void> {
  const snapshot = [...activeEnvironments];
  await Promise.allSettled(
    snapshot.map((environment) => environment.teardown()),
  );
}

export type TemporalEnvironmentFactoryTarget = {
  createTimeSkipping: (
    opts?: TimeSkippingTestWorkflowEnvironmentOptions,
  ) => Promise<TestWorkflowEnvironment>;
  createLocal: (
    opts?: LocalTestWorkflowEnvironmentOptions,
  ) => Promise<TestWorkflowEnvironment>;
};

export function installTemporalTestEnvironmentLifecycle(
  target: TemporalEnvironmentFactoryTarget = TestWorkflowEnvironment,
  leaseOptions: { ttlMs?: number; tendDir?: string } = {},
): void {
  if (installedTargets.has(target)) return;
  installedTargets.add(target);

  const originalCreateTimeSkipping = target.createTimeSkipping.bind(target);
  target.createTimeSkipping = async (
    opts?: TimeSkippingTestWorkflowEnvironmentOptions,
  ): Promise<TestWorkflowEnvironment> => {
    const environment = await originalCreateTimeSkipping(opts);
    try {
      await attachTemporalEnvironmentLease(environment, leaseOptions);
      return environment;
    } catch (error) {
      await environment.teardown();
      throw error;
    }
  };

  const originalCreateLocal = target.createLocal.bind(target);
  target.createLocal = async (
    opts?: LocalTestWorkflowEnvironmentOptions,
  ): Promise<TestWorkflowEnvironment> => {
    const environment = await originalCreateLocal(opts);
    try {
      await attachTemporalEnvironmentLease(environment, leaseOptions);
      return environment;
    } catch (error) {
      await environment.teardown();
      throw error;
    }
  };
}

export function findDirectTemporalServerChildPids(
  psOutput: string,
  parentPid: number,
  selfPid = process.pid,
): number[] {
  const pids: number[] = [];
  for (const rawLine of psOutput.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S.*)$/u.exec(rawLine);
    if (match === null) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    const command = match[3] ?? "";
    if (pid <= 0) continue;
    if (pid === selfPid) continue;
    if (ppid !== parentPid) continue;
    if (command.includes("temporal-test-server")) {
      pids.push(pid);
    }
  }
  return pids;
}

export function reapDirectTemporalTestServerChildren(
  parentPid = process.pid,
): number[] {
  if (process.platform === "win32") return [];
  const snapshot = spawnSync("ps", ["-ax", "-o", "pid=,ppid=,command="], {
    encoding: "utf8",
    env: { ...env, LC_ALL: "C" },
  });
  if (snapshot.status !== 0 || typeof snapshot.stdout !== "string") {
    return [];
  }
  const reaped: number[] = [];
  for (const childPid of findDirectTemporalServerChildPids(
    snapshot.stdout,
    parentPid,
  )) {
    try {
      process.kill(childPid, "SIGKILL");
      reaped.push(childPid);
    } catch {
      // Child already exited between ps snapshot and kill.
    }
  }
  return reaped;
}

export async function createLeasedLocalTemporalEnvironment(
  opts?: LocalTestWorkflowEnvironmentOptions,
  leaseOptions: { ttlMs?: number; tendDir?: string } = {},
): Promise<TestWorkflowEnvironment> {
  const environment = await TestWorkflowEnvironment.createLocal(opts);
  try {
    await attachTemporalEnvironmentLease(environment, leaseOptions);
    return environment;
  } catch (error) {
    await environment.teardown();
    throw error;
  }
}
