import type { MediaAutomationContext } from "#automation/context.ts";
import { serializable } from "#automation/store.ts";
import { ProviderIdSchema } from "#automation/providers.ts";
import { IntegrationError } from "#integrations/http.ts";
import { runtimeAuthority } from "#infrastructure/handoff/authority.ts";
import {
  NativeFeedProviderSchema,
  readFeedCursorV1,
} from "#shared/feeds/contract.ts";
import {
  beginNativeFeedPageV1,
  commitNativeFeedPageV1,
  feedInvocationId,
  readFeedPageReceiptV1,
  writeFeedPageReceiptV1,
} from "#automation/feeds/checkpoint.ts";

/** One native page per Activity; source observations and their matching outbox are durable. */
export async function sweepFeeds(
  context: MediaAutomationContext,
  cursor: string | null,
  sweepId: string,
) {
  const invocationId = feedInvocationId(sweepId, cursor);
  const ack = await readFeedPageReceiptV1(context.db, invocationId);
  if (ack !== null)
    return { processed: ack.scanned, nextCursor: ack.nextCursor };
  const continuation = readFeedCursorV1(cursor);
  const provider = await context.db.mediaProvider.findFirst({
    where: {
      id:
        continuation === null
          ? {
              in: ProviderIdSchema.options,
              ...(cursor === null ? {} : { gt: cursor }),
            }
          : continuation.providerId,
      ...(continuation === null ? { enabled: true } : {}),
    },
    orderBy: { id: "asc" },
  });
  if (provider === null) return { processed: 0, nextCursor: null };
  if (!NativeFeedProviderSchema.safeParse(provider.id).success) {
    const receipt = {
      schemaVersion: 1 as const,
      providerId: ProviderIdSchema.parse(provider.id),
      cycleId: sweepId,
      page: 1,
      scanned: 0,
      sourceIds: [],
      nextCursor: provider.id,
    };
    await serializable(context.db, async (tx) => {
      if ((await readFeedPageReceiptV1(tx, invocationId)) !== null) return;
      await tx.mediaProvider.update({
        where: { id: provider.id },
        data: { feedState: "unsupported_recent_feed", lastFeedAt: new Date() },
      });
      await writeFeedPageReceiptV1(tx, invocationId, receipt);
    });
    return { processed: 0, nextCursor: provider.id };
  }
  try {
    const runtime = await runtimeAuthority(context.db);
    if (
      !provider.enabled ||
      !runtime.active ||
      !(await context.gates.acquisition())
    ) {
      await context.db.mediaProvider.update({
        where: { id: provider.id },
        data: { feedState: "paused" },
      });
      return { processed: 0, nextCursor: provider.id };
    }
    const prepared = await beginNativeFeedPageV1(context, {
      providerId: provider.id,
      sweepId,
      invocationId,
    });
    if (prepared.checkpoint.completed)
      return { processed: 0, nextCursor: provider.id };
    if (
      continuation !== null &&
      (continuation.cycleId !== prepared.checkpoint.cycleId ||
        continuation.page !== prepared.checkpoint.page)
    )
      throw new IntegrationError(provider.id, "conflict");
    const page = await context.providers.withProvider(provider.id, (client) => {
      if (client.recent === undefined)
        throw new Error(
          "Native provider registry lost its required recent-page capability",
        );
      return client.recent({ page: prepared.checkpoint.page });
    });
    const receipt = await commitNativeFeedPageV1(context, { prepared, page });
    return { processed: receipt.scanned, nextCursor: receipt.nextCursor };
  } catch (error) {
    if (!(error instanceof IntegrationError)) throw error;
    await context.db.mediaProvider.update({
      where: { id: provider.id },
      data: { feedState: "error", lastError: error.kind },
    });
    return { processed: 0, nextCursor: provider.id };
  }
}
