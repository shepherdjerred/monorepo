import type { Prisma } from "#generated/prisma/client/index.js";
import type { MemoryClaim } from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import {
  buildMemoryClaimFamilyKey,
  buildMemoryClaimFamilyKeyFromClaim,
} from "@shepherdjerred/birmel/memory/identity.ts";
import type {
  MemoryApplicationContext,
  MemoryCandidateEnvelope,
} from "@shepherdjerred/birmel/memory/schemas.ts";

function maximumDiscordId(messageIds: readonly string[]): string {
  const latest = messageIds.reduce<bigint | null>((maximum, messageId) => {
    const value = BigInt(messageId);
    return maximum === null || value > maximum ? value : maximum;
  }, null);
  if (latest === null) {
    throw new Error("Memory extraction fence requires a source message ID");
  }
  return latest.toString();
}

export async function upsertMemoryExtractionFence(options: {
  transaction: Prisma.TransactionClient;
  claim: MemoryClaim;
  sourceDiscordMessageIds: readonly string[];
}): Promise<void> {
  const familyKey = buildMemoryClaimFamilyKeyFromClaim(options.claim);
  const sourceOrder = maximumDiscordId(options.sourceDiscordMessageIds);
  const existing = await options.transaction.memoryExtractionFence.findUnique({
    where: { familyKey },
  });
  const nextSourceOrder =
    existing == null || BigInt(sourceOrder) > BigInt(existing.sourceOrder)
      ? sourceOrder
      : existing.sourceOrder;
  await options.transaction.memoryExtractionFence.upsert({
    where: { familyKey },
    create: { familyKey, sourceOrder: nextSourceOrder },
    update: { sourceOrder: nextSourceOrder },
  });
}

export async function upsertMemorySourceFences(options: {
  transaction: Prisma.TransactionClient;
  sourceDiscordMessageIds: readonly string[];
  reason: "forget" | "privacy";
}): Promise<void> {
  for (const sourceDiscordMessageId of new Set(
    options.sourceDiscordMessageIds,
  )) {
    await options.transaction.memorySourceFence.upsert({
      where: { sourceDiscordMessageId },
      create: { sourceDiscordMessageId, reason: options.reason },
      update: { reason: options.reason },
    });
  }
}

export async function isMemoryCandidateFenced(options: {
  transaction: Prisma.TransactionClient;
  context: MemoryApplicationContext;
  envelope: MemoryCandidateEnvelope;
  reactivateForgotten: boolean;
}): Promise<boolean> {
  const sourceOrder = options.envelope.provenance?.sourceOrder;
  if (options.reactivateForgotten || sourceOrder == null) {
    return false;
  }
  const erasedSource = await options.transaction.memorySourceFence.findFirst({
    where: {
      sourceDiscordMessageId: {
        in: options.envelope.candidate.sourceDiscordMessageIds,
      },
    },
    select: { sourceDiscordMessageId: true },
  });
  if (erasedSource != null) {
    return true;
  }
  const familyKey = buildMemoryClaimFamilyKey({
    context: options.context,
    candidate: options.envelope.candidate,
  });
  const fence = await options.transaction.memoryExtractionFence.findUnique({
    where: { familyKey },
  });
  return fence != null && BigInt(sourceOrder) <= BigInt(fence.sourceOrder);
}
