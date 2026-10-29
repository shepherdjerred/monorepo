import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { serializable } from "#automation/store.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { IntegrationError } from "#integrations/http.ts";
import type { ProviderRecentPage } from "#integrations/providers.ts";
import {
  FeedCheckpointV1Schema,
  FeedPageReceiptV1Schema,
  NativeFeedProviderSchema,
  encodeFeedCursorV1,
  type FeedPageReceiptV1,
} from "#shared/feeds/contract.ts";
import { retainFeedSourceV1 } from "./source.ts";

export function feedInvocationId(sweepId: string, cursor: string | null) {
  return `feed-page-v1:${identityHash({ sweepId, cursor })}`;
}

export async function readFeedPageReceiptV1(
  tx: Prisma.TransactionClient,
  id: string,
) {
  const row = await tx.reconciliationScan.findUnique({ where: { id } });
  if (row === null) return null;
  if (
    row.kind !== "provider_feed_page_v1" ||
    row.state !== "completed" ||
    row.completedAt === null
  )
    throw new Error(
      "Provider feed page lost its immutable completed checkpoint",
    );
  return FeedPageReceiptV1Schema.parse(row.progress);
}

export async function beginNativeFeedPageV1(
  context: Pick<MediaAutomationContext, "db">,
  input: { providerId: string; sweepId: string; invocationId: string },
) {
  const providerId = NativeFeedProviderSchema.parse(input.providerId);
  const id = `feed-checkpoint-v1:${providerId}`;
  return serializable(context.db, async (tx) => {
    const row = await tx.reconciliationScan.upsert({
      where: { id },
      update: {},
      create: {
        id,
        kind: "provider_feed_checkpoint_v1",
        progress: {
          schemaVersion: 1,
          providerId,
          cycleId: input.sweepId,
          page: 1,
          priorHead: [],
          head: [],
          completed: false,
        },
      },
    });
    await tx.$queryRaw`SELECT id FROM "ReconciliationScan" WHERE id=${id} FOR UPDATE`;
    const current = await tx.reconciliationScan.findUniqueOrThrow({
      where: { id },
    });
    if (row.kind !== "provider_feed_checkpoint_v1" || current.kind !== row.kind)
      throw new Error("Provider feed checkpoint kind changed");
    let checkpoint = FeedCheckpointV1Schema.parse(current.progress);
    if (checkpoint.providerId !== providerId)
      throw new Error("Provider feed checkpoint changed provider");
    if (checkpoint.completed && checkpoint.cycleId !== input.sweepId) {
      checkpoint = {
        ...checkpoint,
        cycleId: input.sweepId,
        page: 1,
        priorHead: checkpoint.head,
        head: [],
        completed: false,
      };
      await tx.reconciliationScan.update({
        where: { id },
        data: { progress: checkpoint },
      });
    }
    return {
      id,
      invocationId: input.invocationId,
      checkpoint,
      checkpointHash: identityHash(checkpoint),
    };
  });
}

/** The source observations, match outbox, page ACK and next checkpoint commit together. */
export async function commitNativeFeedPageV1(
  context: Pick<MediaAutomationContext, "db" | "cipher">,
  input: {
    prepared: Awaited<ReturnType<typeof beginNativeFeedPageV1>>;
    page: ProviderRecentPage;
  },
): Promise<FeedPageReceiptV1> {
  const { prepared, page } = input;
  const expected = prepared.checkpoint;
  const limit = expected.providerId === "knaben" ? 100 : 50;
  if (
    !Number.isSafeInteger(page.scanned) ||
    page.scanned < page.candidates.length ||
    page.scanned > limit ||
    (page.nextPage !== null && page.nextPage !== expected.page + 1)
  )
    throw new Error(
      "Provider feed page exceeded its exact row or continuation bounds",
    );
  return serializable(context.db, async (tx) => {
    const ack = await readFeedPageReceiptV1(tx, prepared.invocationId);
    if (ack !== null) return ack;
    await tx.$queryRaw`SELECT id FROM "MediaProvider" WHERE id=${expected.providerId} FOR SHARE`;
    const provider = await tx.mediaProvider.findUniqueOrThrow({
      where: { id: expected.providerId },
    });
    if (!provider.enabled)
      throw new IntegrationError(provider.id, "interaction-required");
    await tx.$queryRaw`SELECT id FROM "ReconciliationScan" WHERE id=${prepared.id} FOR UPDATE`;
    const current = await tx.reconciliationScan.findUniqueOrThrow({
      where: { id: prepared.id },
    });
    if (
      identityHash(current.progress) !== prepared.checkpointHash ||
      expected.completed
    )
      throw new IntegrationError(provider.id, "conflict");
    const sources: { id: string; identityHash: string }[] = [];
    for (const source of page.candidates) {
      if (source.providerId !== expected.providerId)
        throw new Error("Provider feed returned another provider's source");
      sources.push(await retainFeedSourceV1(tx, context.cipher, source));
    }
    const hashes = [...new Set(sources.map((source) => source.identityHash))];
    const head = expected.head.length === 0 ? hashes : expected.head;
    const overlap = hashes.some((hash) => expected.priorHead.includes(hash));
    const bootstrap = expected.priorHead.length === 0 && head.length > 0;
    const completed = page.nextPage === null || overlap || bootstrap;
    const checkpoint = FeedCheckpointV1Schema.parse({
      ...expected,
      head,
      completed,
      page: page.nextPage ?? expected.page,
    });
    const receipt = FeedPageReceiptV1Schema.parse({
      schemaVersion: 1,
      providerId: expected.providerId,
      cycleId: expected.cycleId,
      page: expected.page,
      scanned: page.scanned,
      sourceIds: sources.map((source) => source.id),
      nextCursor: completed
        ? expected.providerId
        : encodeFeedCursorV1({
            providerId: checkpoint.providerId,
            cycleId: checkpoint.cycleId,
            page: checkpoint.page,
          }),
    });
    await writeFeedPageReceiptV1(tx, prepared.invocationId, receipt);
    await tx.reconciliationScan.update({
      where: { id: prepared.id },
      data: { progress: checkpoint },
    });
    await tx.mediaProvider.update({
      where: { id: provider.id },
      data: {
        feedState: completed ? "current" : "catching_up",
        lastFeedAt: new Date(),
      },
    });
    return receipt;
  });
}

export async function writeFeedPageReceiptV1(
  tx: Prisma.TransactionClient,
  id: string,
  receipt: FeedPageReceiptV1,
) {
  await tx.reconciliationScan.create({
    data: {
      id,
      kind: "provider_feed_page_v1",
      state: "completed",
      progress: receipt,
      completedAt: new Date(),
    },
  });
}
