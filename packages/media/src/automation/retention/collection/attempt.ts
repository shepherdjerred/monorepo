import { z } from "zod";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import { CollectionMembershipSchema } from "./membership.ts";

export const LEAVING_SOON_ATTEMPT_KIND =
  "reconcile_leaving_soon_collection_membership";
const MAX_PENDING = 1000;

const CollectionAttemptSchema = z.strictObject({
  collectionGuid: z.string().min(1).max(2048),
  collectionTitle: z.string().min(1).max(200),
  member: CollectionMembershipSchema,
  present: z.boolean(),
});
type CollectionAttempt = z.infer<typeof CollectionAttemptSchema>;

export async function unresolvedMembers(
  tx: Prisma.TransactionClient,
  collectionKey: string,
  collectionGuid: string,
): Promise<ReadonlySet<string> | null> {
  const attempts = await tx.operation.findMany({
    where: {
      kind: LEAVING_SOON_ATTEMPT_KIND,
      targetId: collectionKey,
      status: "reconciling",
    },
    select: { payload: true },
    take: MAX_PENDING + 1,
  });
  if (attempts.length > MAX_PENDING) return null;
  const protectedKeys = new Set<string>();
  for (const { payload } of attempts) {
    const attempt = CollectionAttemptSchema.parse(payload);
    if (attempt.collectionGuid !== collectionGuid) return null;
    protectedKeys.add(attempt.member.ratingKey);
  }
  return protectedKeys;
}

/** The client here is deliberately outside the caller's checkpoint transaction. */
export async function recordCollectionAttempt(
  db: MediaAutomationContext["db"],
  collectionKey: string,
  input: CollectionAttempt,
): Promise<string> {
  const operation = await db.operation.create({
    data: {
      kind: LEAVING_SOON_ATTEMPT_KIND,
      targetId: collectionKey,
      status: "reconciling",
      payload: CollectionAttemptSchema.parse(input),
    },
    select: { id: true },
  });
  return operation.id;
}

/** Leave the durable operation open unless the effect and acknowledgement both succeed. */
export async function runCollectionAttempt(effect: {
  record: () => Promise<string>;
  applyAndVerify: () => Promise<void>;
  acknowledge: (operationId: string) => Promise<void>;
}): Promise<void> {
  const operationId = await effect.record();
  await effect.applyAndVerify();
  await effect.acknowledge(operationId);
}
