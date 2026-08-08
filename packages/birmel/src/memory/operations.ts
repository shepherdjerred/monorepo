import type { PrismaClient } from "#generated/prisma/client/index.js";
import type { MemoryClaim } from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import { applyMemoryCandidates } from "@shepherdjerred/birmel/memory/apply.ts";
import {
  ForgetMemoryClaimInputSchema,
  ForgetMemoryClaimResultSchema,
  MemoryClaimHistorySchema,
  MemoryClaimReferenceSchema,
  MemoryScopeSelectionSchema,
  PrivacyEraseMemoryClaimInputSchema,
  PrivacyEraseMemoryClaimResultSchema,
  RememberMemoryInputSchema,
  type ForgetMemoryClaimResult,
  type MemoryClaimHistory,
  type PrivacyEraseMemoryClaimResult,
} from "@shepherdjerred/birmel/memory/schemas.ts";
import { serializeDiscordIds } from "@shepherdjerred/birmel/memory/serialization.ts";
import {
  memoryClaimWithRevisions,
  toMemoryClaim,
  toMemoryClaimHistory,
} from "@shepherdjerred/birmel/memory/stored.ts";
import { withMemorySpan } from "@shepherdjerred/birmel/memory/telemetry.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";

export async function rememberMemoryClaim(
  client: PrismaClient,
  input: unknown,
): Promise<MemoryClaimHistory> {
  const parsed = RememberMemoryInputSchema.parse(input);
  const applied = await applyMemoryCandidates(client, {
    context: parsed.context,
    candidates: [{ candidate: parsed.candidate, embedding: parsed.embedding }],
  });
  const claim = applied.claims[0];
  if (claim === undefined) {
    throw new Error("Remember operation produced no claim");
  }
  return inspectMemoryClaim(client, { claimId: claim.id });
}

export async function inspectMemoryClaim(
  client: PrismaClient,
  input: unknown,
): Promise<MemoryClaimHistory> {
  const parsed = MemoryClaimReferenceSchema.parse(input);
  const row = await client.memoryClaim.findUniqueOrThrow({
    where: { id: parsed.claimId },
    include: memoryClaimWithRevisions,
  });
  return MemoryClaimHistorySchema.parse(toMemoryClaimHistory(row));
}

export async function getMemoryClaimHistory(
  client: PrismaClient,
  input: unknown,
): Promise<MemoryClaimHistory> {
  return inspectMemoryClaim(client, input);
}

export async function listMemoryClaims(
  client: PrismaClient,
  input: unknown,
): Promise<MemoryClaim[]> {
  const parsed = MemoryScopeSelectionSchema.parse(input);
  const rows = await client.memoryClaim.findMany({
    where: {
      guildId: parsed.guildId,
      ...(parsed.scope === undefined ? {} : { scope: parsed.scope }),
      ...(parsed.channelId === undefined
        ? {}
        : { channelId: parsed.channelId }),
      ...(parsed.personaId === undefined
        ? {}
        : { personaId: parsed.personaId }),
      ...(parsed.userId === undefined ? {} : { userId: parsed.userId }),
      status: { in: parsed.statuses },
    },
    include: memoryClaimWithRevisions,
    orderBy: [{ lastConfirmedAt: "desc" }, { id: "asc" }],
  });
  return rows.map((row) => toMemoryClaim(row));
}

export async function forgetMemoryClaim(
  client: PrismaClient,
  input: unknown,
): Promise<ForgetMemoryClaimResult> {
  const parsed = ForgetMemoryClaimInputSchema.parse(input);
  return withMemorySpan("memory.forget", async () => {
    const alreadyForgotten = await client.$transaction(async (transaction) => {
      const existing = await transaction.memoryClaim.findUniqueOrThrow({
        where: { id: parsed.claimId },
      });
      await transaction.memoryClaim.update({
        where: { id: parsed.claimId },
        data: { status: "forgotten" },
      });
      await transaction.memoryRevision.create({
        data: {
          claimId: existing.id,
          action: "forget",
          previousValue: existing.value,
          nextValue: null,
          sourceDiscordMessageIds: serializeDiscordIds(
            parsed.sourceDiscordMessageIds,
          ),
          authorUserId: parsed.authorUserId,
          channelId: parsed.channelId,
          extractorModel: parsed.extractorModel,
          confidence: existing.confidence,
        },
      });
      return existing.status === "forgotten";
    });
    const row = await client.memoryClaim.findUniqueOrThrow({
      where: { id: parsed.claimId },
      include: memoryClaimWithRevisions,
    });
    loggers.memory.info("memory claim tombstoned", { alreadyForgotten });
    return ForgetMemoryClaimResultSchema.parse({
      claim: toMemoryClaim(row),
      alreadyForgotten,
    });
  });
}

export async function privacyEraseMemoryClaim(
  client: PrismaClient,
  input: unknown,
): Promise<PrivacyEraseMemoryClaimResult> {
  const parsed = PrivacyEraseMemoryClaimInputSchema.parse(input);
  return withMemorySpan("memory.privacy_erase", async () => {
    const erasedRevisionCount = await client.$transaction(
      async (transaction) => {
        const revisionCount = await transaction.memoryRevision.count({
          where: { claimId: parsed.claimId },
        });
        await transaction.memoryClaim.delete({
          where: { id: parsed.claimId },
        });
        return revisionCount;
      },
    );
    loggers.memory.info("memory claim privacy-erased", {
      erasedRevisionCount,
    });
    return PrivacyEraseMemoryClaimResultSchema.parse({
      erasedClaimId: parsed.claimId,
      erasedRevisionCount,
    });
  });
}
