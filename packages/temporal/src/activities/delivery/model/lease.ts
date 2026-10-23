import { Context } from "@temporalio/activity";
import {
  DeploymentSchema,
  type DeploymentDetail,
} from "@shepherdjerred/delivery/contract";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { deploymentPath, executorIdentity } from "./stages.ts";

/** The soonest a renewal is attempted again, so a lapsed lease is not polled tightly. */
const MIN_RENEWAL_DELAY_MS = 10_000;

type Lease = {
  /** The lease's current expiry, or null once handed off (D8). */
  expiresAt: string | null;
  /** Renews it and returns the new expiry. */
  renew: () => Promise<string | null>;
  failed: (error: unknown) => void;
};

/** The owned deployment's lease, renewed under this Activity's executor identity (D7). */
export function stepLease(current: DeploymentDetail): Lease {
  // Read once in the Activity's context; timers renew on its behalf later.
  const executor = executorIdentity();
  const logger = Context.current().log;
  const id = current.deployment.id;
  return {
    expiresAt: current.deployment.leaseExpiresAt,
    renew: async () => {
      const renewed = await deliveryRequest(
        `${deploymentPath(id)}/lease`,
        DeploymentSchema,
        executor,
      );
      return renewed.leaseExpiresAt;
    },
    failed: (error) => {
      logger.warn("Delivery lease renewal failed; retrying", { error });
    },
  };
}

function renewalDelay(expiresAt: string) {
  return Math.max(
    MIN_RENEWAL_DELAY_MS,
    (Date.parse(expiresAt) - Date.now()) / 2,
  );
}

/**
 * Keeps the lease alive while one step runs (D7). A sync may wait 1,200
 * seconds and a Tofu Job longer, beyond the default 900-second lease, and
 * nothing else renews it mid-step. Each renewal is due at half the time
 * left, so a slow or failed renewal is retried before the lease lapses. A
 * failed renewal is reported and retried, not thrown: the step's own stage
 * writes are the ownership proof, and the server refuses them once the
 * lease has lapsed.
 */
export async function withLeaseRenewal<T>(
  lease: Lease,
  run: () => Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  const schedule = (expiresAt: string) => {
    timer = setTimeout(() => {
      void (async () => {
        let next: string | null = expiresAt;
        try {
          next = await lease.renew();
        } catch (error) {
          lease.failed(error);
        }
        if (!settled && next !== null) schedule(next);
      })();
    }, renewalDelay(expiresAt));
  };
  if (lease.expiresAt !== null) schedule(lease.expiresAt);
  try {
    return await run();
  } finally {
    settled = true;
    clearTimeout(timer);
  }
}
