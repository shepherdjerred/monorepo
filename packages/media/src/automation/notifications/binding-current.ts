import type { Prisma } from "#generated/prisma/client.ts";
import { assertBoundMediaCohort } from "#automation/retention/binding.ts";
import type { RequesterWatchContext } from "./requester-watch.ts";
import { isReadiness } from "./readiness.ts";

export async function messageBindingCurrent(
  tx: Prisma.TransactionClient,
  context: RequesterWatchContext,
  delivery: { event: { kind: string } },
): Promise<boolean> {
  if (
    !isReadiness(delivery.event.kind) &&
    delivery.event.kind !== "retention_warning"
  )
    return true;
  if (context.binding === undefined) return false;
  await assertBoundMediaCohort(
    tx,
    context.binding.cohort,
    context.binding.freshness,
  );
  if (
    context.binding.cohort.original.some(
      (value) => value.authority.purpose !== "current_serving",
    )
  )
    return false;
  context.captureFreshness?.(context.binding.freshness);
  return true;
}
