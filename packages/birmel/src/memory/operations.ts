import type { Prisma, PrismaClient } from "#generated/prisma/client/index.js";
import type { MemoryClaim } from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import { applyMemoryCandidates } from "@shepherdjerred/birmel/memory/apply.ts";
import {
  upsertMemoryExtractionFence,
  upsertMemorySourceFences,
} from "@shepherdjerred/birmel/memory/extraction-fence.ts";
import { buildMemoryClaimFamilyKeyFromClaim } from "@shepherdjerred/birmel/memory/identity.ts";
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
import {
  deserializeDiscordIds,
  serializeDiscordIds,
} from "@shepherdjerred/birmel/memory/serialization.ts";
import {
  memoryClaimWithRevisions,
  toMemoryClaim,
  toMemoryClaimHistory,
} from "@shepherdjerred/birmel/memory/stored.ts";
import { withMemorySpan } from "@shepherdjerred/birmel/memory/telemetry.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";

type MemoryClaimRow = Prisma.MemoryClaimGetPayload<{
  include: { revisions: true };
}>;

function revisionSourceIds(claim: MemoryClaimRow): string[] {
  return claim.revisions.flatMap((revision) =>
    deserializeDiscordIds(revision.sourceDiscordMessageIds),
  );
}

function privacyEraseSelection(options: {
  exactFamily: MemoryClaimRow[];
  commandSourceId: string;
}): { claimIds: string[]; sourceDiscordMessageIds: string[] } {
  return {
    claimIds: options.exactFamily.map(({ id }) => id),
    sourceDiscordMessageIds: [
      options.commandSourceId,
      ...options.exactFamily.flatMap((claim) => revisionSourceIds(claim)),
    ],
  };
}

export async function rememberMemoryClaim(
  client: PrismaClient,
  input: unknown,
): Promise<MemoryClaimHistory> {
  const parsed = RememberMemoryInputSchema.parse(input);
  const applied = await applyMemoryCandidates(client, {
    context: parsed.context,
    candidates: [
      {
        candidate: parsed.candidate,
        embedding: parsed.embedding,
        provenance: {
          authorUserId: parsed.context.authorUserId,
          channelId: parsed.context.channelId,
          sourceOrder: parsed.sourceOrder,
        },
      },
    ],
    reactivateForgotten: true,
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
        include: memoryClaimWithRevisions,
      });
      const selectedClaim = toMemoryClaim(existing);
      const familyKey = buildMemoryClaimFamilyKeyFromClaim(selectedClaim);
      const possibleFamily = await transaction.memoryClaim.findMany({
        where: { guildId: selectedClaim.guildId, scope: selectedClaim.scope },
        include: memoryClaimWithRevisions,
      });
      const family = possibleFamily.filter(
        (claim) =>
          buildMemoryClaimFamilyKeyFromClaim(toMemoryClaim(claim)) ===
          familyKey,
      );
      await upsertMemoryExtractionFence({
        transaction,
        claim: selectedClaim,
        sourceDiscordMessageIds: parsed.sourceDiscordMessageIds,
      });
      await upsertMemorySourceFences({
        transaction,
        sourceDiscordMessageIds: [
          ...family.flatMap(({ revisions }) =>
            revisions.flatMap((revision) =>
              deserializeDiscordIds(revision.sourceDiscordMessageIds),
            ),
          ),
          ...parsed.sourceDiscordMessageIds,
        ],
        reason: "forget",
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
        const existing = await transaction.memoryClaim.findUniqueOrThrow({
          where: { id: parsed.claimId },
          include: memoryClaimWithRevisions,
        });
        const selectedClaim = toMemoryClaim(existing);
        const familyKey = buildMemoryClaimFamilyKeyFromClaim(selectedClaim);
        await upsertMemoryExtractionFence({
          transaction,
          claim: selectedClaim,
          sourceDiscordMessageIds: [parsed.sourceDiscordMessageId],
        });
        const possibleFamily = await transaction.memoryClaim.findMany({
          where: { guildId: selectedClaim.guildId },
          include: memoryClaimWithRevisions,
        });
        const family = possibleFamily.filter(
          (claim) =>
            buildMemoryClaimFamilyKeyFromClaim(toMemoryClaim(claim)) ===
            familyKey,
        );
        const erase = privacyEraseSelection({
          exactFamily: family,
          commandSourceId: parsed.sourceDiscordMessageId,
        });
        await upsertMemorySourceFences({
          transaction,
          sourceDiscordMessageIds: erase.sourceDiscordMessageIds,
          reason: "privacy",
        });
        await transaction.memoryClaim.deleteMany({
          where: { id: { in: erase.claimIds } },
        });
        return possibleFamily
          .filter(({ id }) => erase.claimIds.includes(id))
          .reduce((count, claim) => count + claim.revisions.length, 0);
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
