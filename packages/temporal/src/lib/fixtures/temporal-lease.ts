import {
  type LocalTestWorkflowEnvironmentOptions,
  TestWorkflowEnvironment,
} from "@temporalio/testing";
import {
  acquireTemporalTendLease,
  type TemporalTendLeaseHandle,
} from "@shepherdjerred/root-scripts/lib/temporal/temporal-tend-lease.ts";

const leasedEnvironments = new WeakMap<
  TestWorkflowEnvironment,
  Promise<TemporalTendLeaseHandle>
>();

export function attachTemporalEnvironmentLease(
  environment: TestWorkflowEnvironment,
  options: { ttlMs?: number; tendDir?: string } = {},
): Promise<TemporalTendLeaseHandle> {
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
      const lease = await created.catch(() => null);
      await lease?.release();
    }
  };

  return created;
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
