import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import {
  DeploymentSchema,
  type DeploymentDetail,
} from "@shepherdjerred/delivery/contract";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { withLeaseLoss } from "#lib/delivery/model/effect-signal.ts";
import { deploymentPath, executorIdentity } from "./stages.ts";

/** The soonest a renewal is attempted again, so a lapsed lease is not polled tightly. */
const MIN_RENEWAL_DELAY_MS = 10_000;

type Lease = {
  /** The lease's current expiry, or null once handed off (D8). */
  expiresAt: string | null;
  /** Renews it and returns the new expiry. */
  renew: () => Promise<string | null>;
  failed: (error: unknown) => void;
  /** This executor no longer holds the lease; the step's effects are aborted. */
  lost: (reason: string) => void;
};

/**
 * Why the server refused a renewal, or null for a transient failure. A
 * refusal means the lease lapsed or another executor owns it (D7, D8).
 */
function refusal(error: unknown): string | null {
  return error instanceof ApplicationFailure &&
    error.type === "DeliveryApi:CONFLICT"
    ? error.message
    : null;
}

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
    lost: (reason) => {
      logger.warn("Delivery lease lost; aborting the step's effects", {
        reason,
      });
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
 * transient failure is reported and retried. The lease is lost when the
 * server refuses a renewal or its expiry passes without one; `effectSignal`
 * then aborts every effect still running, and the server refuses the step's
 * stage writes from then on.
 */
export async function withLeaseRenewal<T>(
  lease: Lease,
  run: () => Promise<T>,
): Promise<T> {
  const lost = new AbortController();
  let renewal: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  const lose = (reason: string) => {
    if (settled || lost.signal.aborted) return;
    lease.lost(reason);
    lost.abort(new Error(reason));
  };
  const expireAt = (expiresAt: string) => {
    clearTimeout(deadline);
    deadline = setTimeout(
      () => {
        lose(
          `The deployment's lease expired at ${expiresAt} without a renewal (D7)`,
        );
      },
      Math.max(0, Date.parse(expiresAt) - Date.now()),
    );
  };
  const schedule = (expiresAt: string) => {
    renewal = setTimeout(() => {
      void (async () => {
        let next: string | null = expiresAt;
        try {
          next = await lease.renew();
          if (next !== null) expireAt(next);
        } catch (error) {
          const refused = refusal(error);
          if (refused !== null) {
            lose(`The server refused the lease renewal: ${refused}`);
            return;
          }
          lease.failed(error);
        }
        if (!settled && next !== null) schedule(next);
      })();
    }, renewalDelay(expiresAt));
  };
  if (lease.expiresAt !== null) {
    expireAt(lease.expiresAt);
    schedule(lease.expiresAt);
  }
  try {
    return await withLeaseLoss(lost.signal, run);
  } finally {
    settled = true;
    clearTimeout(renewal);
    clearTimeout(deadline);
  }
}
