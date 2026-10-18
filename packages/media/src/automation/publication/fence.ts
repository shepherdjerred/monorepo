import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { CompensationPublicationPort } from "./execution.ts";
import { serializable } from "#automation/store.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { assertNoPublicationCompensationFence } from "#infrastructure/native-compensation/fence.ts";
import { defaultScope } from "#shared/editions/scope.ts";

type Scope = {
  mediaIds: string[];
  assetIds: string[];
  compensation: CompensationPublicationPort | undefined;
};

export async function beforePublicationRefresh(
  context: MediaAutomationContext,
  scope: Scope,
): Promise<void> {
  if (scope.compensation !== undefined)
    return scope.compensation.beforeNetwork();
  await serializable(context.db, (tx) => lockPublicationScope(tx, scope));
}

export async function lockPublicationScope(
  tx: Prisma.TransactionClient,
  scope: Scope,
): Promise<void> {
  await scope.compensation?.lockAndAssert(tx);
  await lockDefaultScopes(
    tx,
    scope.mediaIds.map((id) => defaultScope(id)),
    { createMissing: false },
  );
  if (scope.compensation === undefined)
    await assertNoPublicationCompensationFence(tx, {
      mediaIds: scope.mediaIds,
      assetIds: scope.assetIds,
    });
}
