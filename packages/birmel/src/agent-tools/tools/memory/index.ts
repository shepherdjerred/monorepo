import { openai } from "@ai-sdk/openai";
import { embed } from "ai";
import { z } from "zod";
import {
  DiscordIdSchema,
  MemoryScopeSchema,
  type MemoryCandidate,
} from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import { createTool } from "@shepherdjerred/birmel/agent-runtime/tools/create-tool.ts";
import {
  getRequestContext,
  type RequestContext,
} from "@shepherdjerred/birmel/agent-tools/tools/request-context.ts";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import { correctMemoryClaim } from "@shepherdjerred/birmel/memory/apply.ts";
import {
  forgetMemoryClaim,
  getMemoryClaimHistory,
  privacyEraseMemoryClaim,
  rememberMemoryClaim,
} from "@shepherdjerred/birmel/memory/operations.ts";
import { retrieveMemoryClaims } from "@shepherdjerred/birmel/memory/retrieve.ts";
import { getErrorMessage } from "@shepherdjerred/birmel/utils/errors.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";

const logger = loggers.memory.child("manage-memory");

const InputSchema = z.object({
  action: z.enum([
    "remember",
    "query",
    "correct",
    "history",
    "forget",
    "privacy-erase",
  ]),
  guildId: z.string(),
  claimId: z.uuid().optional(),
  scope: MemoryScopeSchema.optional(),
  subject: z.string().min(1).max(500).optional(),
  predicate: z.string().min(1).max(200).optional(),
  value: z.string().min(1).max(4000).optional(),
  query: z.string().max(8000).optional(),
  confidence: z.number().min(0).max(1).optional(),
  salience: z.number().min(0).max(1).optional(),
  validFrom: z.iso.datetime().nullable().optional(),
  validUntil: z.iso.datetime().nullable().optional(),
  relatedUserIds: z.array(DiscordIdSchema).max(50).optional(),
});

const OutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.unknown().optional(),
});
type MemoryToolInput = z.infer<typeof InputSchema>;
const ClaimMutationActionSchema = z.enum([
  "history",
  "forget",
  "privacy-erase",
  "correct",
]);

async function embedding(value: string): Promise<number[]> {
  const config = getConfig();
  const result = await embed({
    model: openai.embedding(config.openai.embeddingModel),
    value,
    abortSignal: AbortSignal.timeout(config.agent.responseTimeoutMs),
  });
  return result.embedding;
}

function required<T>(value: T | undefined, name: string): T {
  if (
    value === undefined ||
    (typeof value === "string" && value.length === 0)
  ) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function requireRequestContext(): RequestContext {
  const request = getRequestContext();
  if (request == null) {
    throw new Error("Memory operation requires request context");
  }
  return request;
}

async function queryMemory(input: MemoryToolInput, request: RequestContext) {
  const query = input.query ?? "";
  const result = await retrieveMemoryClaims(prisma, {
    guildId: request.guildId,
    channelId: request.sourceChannelId,
    personaId: request.personaId ?? null,
    userIds: [request.userId, ...(input.relatedUserIds ?? [])],
    relationshipUserIds: [request.userId, ...(input.relatedUserIds ?? [])],
    query,
    queryEmbedding: query.length === 0 ? null : await embedding(query),
    at: new Date(),
    limit: 12,
  });
  return {
    success: true,
    message: `Found ${String(result.claims.length)} relevant memory claims`,
    data: result,
  };
}

async function requireClaimInGuild(
  claimId: string,
  guildId: string,
): Promise<void> {
  const claim = await prisma.memoryClaim.findFirst({
    where: { id: claimId, guildId },
    select: { id: true },
  });
  if (claim == null) {
    throw new Error("Memory claim was not found in this guild");
  }
}

async function inspectOrMutateMemory(
  input: MemoryToolInput,
  request: RequestContext,
) {
  const config = getConfig();
  const claimId = required(input.claimId, "claimId");
  await requireClaimInGuild(claimId, request.guildId);
  const action = ClaimMutationActionSchema.parse(input.action);
  switch (action) {
    case "history":
      return {
        success: true,
        message: "Memory claim history",
        data: await getMemoryClaimHistory(prisma, { claimId }),
      };
    case "forget":
      return {
        success: true,
        message: "Memory claim forgotten",
        data: await forgetMemoryClaim(prisma, {
          claimId,
          sourceDiscordMessageIds: [request.sourceMessageId],
          authorUserId: request.userId,
          channelId: request.sourceChannelId,
          extractorModel: config.openai.memoryModel,
        }),
      };
    case "privacy-erase":
      return {
        success: true,
        message: "Memory claim and revision history permanently erased",
        data: await privacyEraseMemoryClaim(prisma, { claimId }),
      };
    case "correct": {
      const value = required(input.value, "value");
      return {
        success: true,
        message: "Memory claim corrected",
        data: await correctMemoryClaim(prisma, {
          claimId,
          value,
          confidence: input.confidence ?? 1,
          salience: input.salience ?? 0.8,
          validFrom: input.validFrom ?? null,
          validUntil: input.validUntil ?? null,
          sourceDiscordMessageIds: [request.sourceMessageId],
          authorUserId: request.userId,
          channelId: request.sourceChannelId,
          extractorModel: config.openai.memoryModel,
          embedding: await embedding(value),
        }),
      };
    }
  }
}

async function rememberMemory(input: MemoryToolInput, request: RequestContext) {
  const config = getConfig();
  const candidate: MemoryCandidate = {
    scope: required(input.scope, "scope"),
    subject: required(input.subject, "subject"),
    predicate: required(input.predicate, "predicate"),
    value: required(input.value, "value"),
    confidence: input.confidence ?? 1,
    salience: input.salience ?? 0.8,
    origin: "explicit",
    validFrom: input.validFrom ?? null,
    validUntil: input.validUntil ?? null,
    relatedUserIds: input.relatedUserIds ?? [],
    sourceDiscordMessageIds: [request.sourceMessageId],
  };
  return {
    success: true,
    message: "Memory claim remembered",
    data: await rememberMemoryClaim(prisma, {
      context: {
        guildId: request.guildId,
        channelId: request.sourceChannelId,
        userId: request.userId,
        personaId: request.personaId ?? null,
        authorUserId: request.userId,
        extractorModel: config.openai.memoryModel,
      },
      candidate,
      embedding: await embedding(
        `${candidate.subject} ${candidate.predicate} ${candidate.value}`,
      ),
    }),
  };
}

async function executeMemoryAction(input: MemoryToolInput) {
  const request = requireRequestContext();
  if (input.action === "query") {
    return await queryMemory(input, request);
  }
  if (input.action === "remember") {
    return await rememberMemory(input, request);
  }
  return await inspectOrMutateMemory(input, request);
}

export const manageMemoryTool = createTool({
  id: "manage-memory",
  description:
    "Manage durable typed memory claims. Remember an explicit fact or preference, query what is remembered, inspect correction history, correct a claim, tombstone it with forget, or physically erase it for privacy.",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  execute: async (input) => {
    try {
      return await executeMemoryAction(input);
    } catch (error) {
      logger.error("Memory operation failed", error, {
        errorClass: error instanceof Error ? error.name : "UnknownError",
      });
      return { success: false, message: getErrorMessage(error) };
    }
  },
});

export const memoryTools = [manageMemoryTool];
