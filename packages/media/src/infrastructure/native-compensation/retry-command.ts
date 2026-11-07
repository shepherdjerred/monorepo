import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type { MediaActor } from "#application/auth.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { requireOwner } from "#application/errors.ts";
import { PrismaNativeCompensation } from "./service.ts";
import { PrismaSeriesPackNativeCompensationV1 } from "./series-pack/service.ts";
import { seriesPackNativeCommandInvocationV1 } from "./series-pack/command-invocation.ts";

/** Select only the new actual descriptor. Historical retries retain their
 * original producer, command body and Workflow path. */
export async function retryNativeCompensationCommand(
  db: Database,
  describe: MediaAutomationContext["describeWorkflow"] | undefined,
  input: {
    actor: MediaActor;
    key: string;
    id: string;
    review: { expectedVersion: number };
  },
) {
  const invocation = seriesPackNativeCommandInvocationV1();
  requireOwner(input.actor);
  const selected =
    await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: input.id },
      select: { descriptor: true },
    });
  invocation.budget.consume(1);
  return z
    .object({ schemaVersion: z.literal(2) })
    .safeParse(selected.descriptor).success
    ? new PrismaSeriesPackNativeCompensationV1(db, describe).retry(
        input.actor,
        input.key,
        { id: input.id, review: input.review },
        invocation,
      )
    : new PrismaNativeCompensation(db, describe).retry(
        input.actor,
        input.key,
        input.id,
        input.review,
      );
}
