import { z } from "zod";
import { DeliveryError } from "#domain/error.ts";
import type { Principal } from "#shared/contract.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import type { createRecoveryInspector } from "#infrastructure/recovery.ts";
import { recoveryKindOf } from "./recovery-request.ts";

/**
 * Delivery opens and settles recovery itself instead of waiting for a person
 * (D5, I1, I2). A deployment that ended recovery-required gets an intent of
 * its own kind; the kind's independent reader still decides: worker and
 * platform dispatchers prove their target, and an `argo` intent settles only
 * when the API's own Application reader finds the deployment's operations
 * finished. Nothing here trusts the executor or releases a lock by itself.
 *
 * A reader can fail for a reason that passes, such as a Kubernetes API
 * restart, so a failed intent is reopened, bounded: at most
 * {@link AUTO_RECOVERY_ATTEMPTS} automatic intents per deployment, each at
 * least {@link AUTO_RECOVERY_BACKOFF_MS} after the previous intent, opened
 * automatically or by a person, finished. A refusal that persists exhausts
 * the attempts and escalates through DeliveryRecoveryRequired.
 */
export const AUTO_RECOVERY_ACTOR: Principal = {
  id: "delivery/auto-recovery",
  kind: "machine",
  scopes: ["read", "admin"],
};

export const AUTO_RECOVERY_ATTEMPTS = 5;
const AUTO_RECOVERY_BACKOFF_MS = 5 * 60_000;

/** Content repair is a foreground operator command (README, content recovery). */
const OPERATOR_ONLY_KINDS: ReadonlySet<string> = new Set([
  "content",
  "minecraft",
]);

/** Prisma's unique-constraint violation: a concurrent intent won the race. */
const UniqueViolationSchema = z.object({ code: z.literal("P2002") });

export type AutoRecoveryResult = {
  readonly opened: string[];
  readonly skipped: { deploymentId: string; reason: string }[];
};

/**
 * The request id of a deployment's `attempt`-th automatic intent. The first
 * keeps the original `auto-<id>`, so intents opened before retries existed
 * count as the first attempt.
 */
function automaticRequestId(deploymentId: string, attempt: number) {
  return attempt === 1
    ? `auto-${deploymentId}`
    : `auto-${deploymentId}-${String(attempt)}`;
}

/** Why a deployment with no pending intent is not yet due another attempt. */
function notDue(
  intents: { requestedBy: string; finishedAt: Date | null }[],
  now: Date,
): string | null {
  const automatic = intents.filter(
    (intent) => intent.requestedBy === AUTO_RECOVERY_ACTOR.id,
  ).length;
  if (automatic >= AUTO_RECOVERY_ATTEMPTS)
    return `automatic recovery stopped after ${String(automatic)} attempts`;
  let last = 0;
  for (const { finishedAt } of intents) {
    // Every intent that is not pending records when it finished; one that
    // does not is never treated as long past.
    if (finishedAt === null) return "a previous intent has no finish time";
    last = Math.max(last, finishedAt.getTime());
  }
  return now.getTime() - last < AUTO_RECOVERY_BACKOFF_MS
    ? "the previous intent finished too recently"
    : null;
}

export async function openAutomaticRecoveryIntents(
  this: Delivery,
  now: Date = new Date(),
): Promise<AutoRecoveryResult> {
  const candidates = await this.database.deployment.findMany({
    where: {
      recoveryRequired: true,
      recoveryIntents: { none: { status: "pending" } },
    },
    select: {
      id: true,
      recoveryIntents: { select: { requestedBy: true, finishedAt: true } },
    },
  });
  const opened: string[] = [];
  const skipped: { deploymentId: string; reason: string }[] = [];
  for (const { id, recoveryIntents } of candidates) {
    const wait = notDue(recoveryIntents, now);
    if (wait !== null) {
      skipped.push({ deploymentId: id, reason: wait });
      continue;
    }
    const detail = await this.detail(id);
    const kind = recoveryKindOf(detail);
    if (OPERATOR_ONLY_KINDS.has(kind)) {
      skipped.push({
        deploymentId: id,
        reason: `${kind} recovery is operator-run`,
      });
      continue;
    }
    const attempt =
      recoveryIntents.filter(
        (intent) => intent.requestedBy === AUTO_RECOVERY_ACTOR.id,
      ).length + 1;
    try {
      const intent = await this.requestRecoveryIntent(
        id,
        {
          requestId: automaticRequestId(id, attempt),
          reason:
            "Opened automatically: the deployment ended recovery-required and its independent reader decides",
          expectedGeneration: detail.environment.generation,
        },
        AUTO_RECOVERY_ACTOR,
      );
      opened.push(intent.id);
    } catch (error) {
      // A changed binding refuses the intent, and a person may open one
      // concurrently: both are left alone, never forced.
      if (error instanceof DeliveryError)
        skipped.push({ deploymentId: id, reason: error.message });
      else if (UniqueViolationSchema.safeParse(error).success)
        skipped.push({
          deploymentId: id,
          reason: "another recovery intent was opened concurrently",
        });
      else throw error;
    }
  }
  return { opened, skipped };
}

/**
 * Settles each pending `argo` intent whose Applications the API's own
 * reader shows finished: the same inspector the admin route uses proves
 * each Application's recorded request, ownership annotation, finished phase
 * and settled Jobs, taking each one's operation identity from the readback.
 * Anything it cannot prove, or cannot read yet, stays pending for the next
 * tick and never fails the others.
 */
export async function settleAutomaticArgoIntents(
  this: Delivery,
  inspect: ReturnType<typeof createRecoveryInspector>,
): Promise<string[]> {
  const pending = await this.database.recoveryIntent.findMany({
    where: { kind: "argo", status: "pending" },
    select: { id: true, deploymentId: true },
  });
  const settled: string[] = [];
  const reason =
    "Settled automatically by independent Application readback of the finished operation";
  for (const intent of pending) {
    try {
      const detail = await this.detail(intent.deploymentId);
      const evidence = await inspect(detail, { reason });
      await this.settleArgoIntent(
        intent.id,
        reason,
        AUTO_RECOVERY_ACTOR,
        evidence,
      );
      settled.push(intent.id);
    } catch (error) {
      if (!(error instanceof DeliveryError)) throw error;
    }
  }
  return settled;
}
