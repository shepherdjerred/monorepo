import { z } from "zod";
import { DeliveryError } from "#domain/error.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import {
  audit,
  fingerprint,
  lock,
  required,
  wire,
} from "#infrastructure/delivery-records.ts";
import {
  ContentRecoveryIntentSchema,
  type Principal,
} from "#shared/contract.ts";

export async function failContentRecovery(
  this: Delivery,
  id: string,
  message: string,
  actor: Principal,
) {
  requireScope(actor, "execute");
  const input = z
    .strictObject({ message: z.string().trim().min(1).max(4000) })
    .parse({ message });
  return this.database.$transaction(async (tx) => {
    await lock(tx, "delivery:claim");
    await lock(tx, `content-recovery:${id}`);
    const raw = required(
      await tx.contentRecoveryIntent.findUnique({ where: { id } }),
      "Content recovery intent",
    );
    const intent = ContentRecoveryIntentSchema.parse(wire(raw));
    if (intent.status !== "pending") {
      if (
        intent.status !== "failed" ||
        raw.resultFingerprint !== fingerprint(input)
      )
        throw new DeliveryError(
          "CONFLICT",
          "Content recovery result is immutable",
        );
      return intent;
    }
    // A stopped producer remains owned by the SAME retryable intent. Abandoning
    // its journal would strand the global barrier or permit unsafe restoration.
    const stopped =
      intent.dispatchBarrier !== null && intent.barrierRestoredAt === null;
    const updated = await tx.contentRecoveryIntent.update({
      where: { id },
      data: {
        message,
        ...(stopped
          ? {}
          : {
              status: "failed",
              finishedAt: new Date(),
              resultFingerprint: fingerprint(input),
            }),
      },
    });
    await audit(tx, actor, {
      action: stopped
        ? "content.recovery_attempt_failed"
        : "content.recovery_failed",
      entityId: id,
      requestId: id,
      metadata: input,
    });
    return ContentRecoveryIntentSchema.parse(wire(updated));
  });
}
