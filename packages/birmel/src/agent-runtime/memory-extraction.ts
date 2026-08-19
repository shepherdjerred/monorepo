import { embedMany } from "ai";
import { generateValidatedObject } from "@shepherdjerred/llm-runtime";
import { z } from "zod";
import {
  DiscordIdSchema,
  MemoryCandidateSchema,
  type MemoryCandidate,
  type TurnInput,
} from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import type { AgentExecutionResult } from "@shepherdjerred/birmel/agent-runtime/specialists.ts";
import { getLlmRuntime } from "@shepherdjerred/birmel/agent-runtime/llm.ts";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import type { ChannelMessage } from "@shepherdjerred/birmel/discord/utils/channel-history.ts";
import { applyMemoryCandidates } from "@shepherdjerred/birmel/memory/apply.ts";
import { assertAcceptedAliasEvidence } from "@shepherdjerred/birmel/memory/accepted-alias.ts";
import { PERSONA_ALIAS_PREDICATE } from "@shepherdjerred/birmel/memory/aliases.ts";
import { buildGroundedCommitment } from "@shepherdjerred/birmel/memory/commitments.ts";
import {
  MemoryCandidateProvenanceSchema,
  type MemoryCandidateProvenance,
} from "@shepherdjerred/birmel/memory/schemas.ts";
import { normalizeMemoryText } from "@shepherdjerred/birmel/memory/serialization.ts";
import { withSpan } from "@shepherdjerred/birmel/observability/tracing.ts";
import { buildConfiguredPersonaProjection } from "@shepherdjerred/birmel/persona/projection.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";

const logger = loggers.agent.child("memory-extraction");

const SelfMemoryScopeSchema = z.enum(["guild", "persona", "user"]);

const AcceptedAliasMemorySchema = z.strictObject({
  kind: z.literal("accepted-alias"),
  alias: z.string().min(1).max(100),
  confidence: z.number().min(0).max(1),
  salience: z.number().min(0).max(1),
});

const CommitmentMemorySchema = z.strictObject({
  kind: z.literal("commitment"),
  scope: SelfMemoryScopeSchema,
  targetUserId: DiscordIdSchema.nullable(),
  commitment: z.string().min(1).max(2000),
  topic: z.string().min(1).max(200),
  confidence: z.number().min(0).max(1),
  salience: z.number().min(0).max(1),
  validFrom: z.iso.datetime().nullable(),
  validUntil: z.iso.datetime().nullable(),
});

const VerifiedToolExperienceMemorySchema = z.strictObject({
  kind: z.literal("verified-tool-experience"),
  toolId: z.string().min(1).max(64),
  toolCallId: z.string().min(1).max(200),
  scope: SelfMemoryScopeSchema,
  targetUserId: DiscordIdSchema.nullable(),
  subject: z.string().min(1).max(500),
  predicate: z.string().min(1).max(200),
  value: z.string().min(1).max(4000),
  confidence: z.number().min(0).max(1),
  salience: z.number().min(0).max(1),
  validFrom: z.iso.datetime().nullable(),
  validUntil: z.iso.datetime().nullable(),
});

export const SelfMemorySchema = z.discriminatedUnion("kind", [
  AcceptedAliasMemorySchema,
  CommitmentMemorySchema,
  VerifiedToolExperienceMemorySchema,
]);
export type SelfMemory = z.infer<typeof SelfMemorySchema>;

export const ExtractionSchema = z.strictObject({
  humanClaims: z.array(MemoryCandidateSchema.strict()).max(20),
  selfMemories: z.array(SelfMemorySchema).max(20),
});

export const DeliveredAssistantMessageSchema = z.strictObject({
  id: DiscordIdSchema,
  userId: DiscordIdSchema,
  content: z.string().min(1).max(2000),
});
export type DeliveredAssistantMessage = z.infer<
  typeof DeliveredAssistantMessageSchema
>;

type ProvenancedMemoryCandidate = {
  candidate: MemoryCandidate;
  provenance: MemoryCandidateProvenance;
};

type ExtractionSource = {
  messageId: string;
  authorUserId: string;
  channelId: string;
  createdAt: Date;
  isBot: boolean;
};

function compareSourceOrder(left: ExtractionSource, right: ExtractionSource) {
  const timestampDifference =
    left.createdAt.getTime() - right.createdAt.getTime();
  if (timestampDifference !== 0) {
    return timestampDifference;
  }
  const leftId = BigInt(left.messageId);
  const rightId = BigInt(right.messageId);
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

export function attachExtractionProvenance(options: {
  candidates: MemoryCandidate[];
  turn: TurnInput;
  rawRecentMessages: ChannelMessage[];
}): ProvenancedMemoryCandidate[] {
  const sources = new Map<string, ExtractionSource>();
  const addSource = (source: ExtractionSource) => {
    if (sources.has(source.messageId)) {
      throw new Error("Raw memory transcript contains a duplicate message ID");
    }
    sources.set(source.messageId, source);
  };
  for (const message of options.rawRecentMessages) {
    addSource({
      messageId: message.id,
      authorUserId: message.authorId,
      channelId: options.turn.channelId,
      createdAt: message.createdAt,
      isBot: message.isBot,
    });
  }
  addSource({
    messageId: options.turn.discordMessageId,
    authorUserId: options.turn.userId,
    channelId: options.turn.channelId,
    createdAt: options.turn.receivedAt,
    isBot: false,
  });

  return options.candidates.flatMap((rawCandidate, index) => {
    const candidate = MemoryCandidateSchema.parse(rawCandidate);
    if (normalizeMemoryText(candidate.predicate) === PERSONA_ALIAS_PREDICATE) {
      logger.warn("Rejected alias from the human-claim extraction path", {
        candidateIndex: index,
      });
      return [];
    }
    const citedSources = candidate.sourceDiscordMessageIds.map((messageId) => {
      const cited = sources.get(messageId);
      if (cited == null) {
        throw new Error(
          "Memory extractor cited a message outside the raw transcript",
        );
      }
      if (cited.isBot) {
        throw new Error("Memory extractor cited a bot-authored message");
      }
      return cited;
    });
    const latestSource = citedSources.toSorted(compareSourceOrder).at(-1);
    if (latestSource == null) {
      throw new Error("Memory candidate has no cited source");
    }
    const citedAuthors = new Set(
      citedSources.map(({ authorUserId }) => authorUserId),
    );
    if (
      candidate.scope === "user" &&
      candidate.relatedUserIds.length === 0 &&
      citedAuthors.size !== 1
    ) {
      throw new Error(
        "User memory with multiple cited authors requires an explicit target user",
      );
    }
    const resolvedCandidate = MemoryCandidateSchema.parse({
      ...candidate,
      relatedUserIds:
        candidate.scope === "user" && candidate.relatedUserIds.length === 0
          ? [latestSource.authorUserId]
          : candidate.relatedUserIds,
    });
    return [
      {
        candidate: resolvedCandidate,
        provenance: MemoryCandidateProvenanceSchema.parse({
          authorUserId: latestSource.authorUserId,
          channelId: latestSource.channelId,
          sourceOrder: latestSource.messageId,
        }),
      },
    ];
  });
}

function selfMemoryRelatedUserIds(memory: SelfMemory): string[] {
  if (memory.kind === "accepted-alias") {
    return [];
  }
  if (memory.scope === "user") {
    if (memory.targetUserId === null) {
      throw new Error("User-scoped self-memory requires a target user ID");
    }
    return [memory.targetUserId];
  }
  if (memory.targetUserId !== null) {
    throw new Error("Non-user self-memory cannot name a target user ID");
  }
  return [];
}

function selfMemoryCandidate(options: {
  memory: SelfMemory;
  turn: TurnInput;
  assistant: DeliveredAssistantMessage;
  successfulToolEvents: AgentExecutionResult["toolEvents"];
}): MemoryCandidate {
  const sourceDiscordMessageIds = [
    options.turn.discordMessageId,
    options.assistant.id,
  ];
  if (options.memory.kind === "accepted-alias") {
    const canonicalAlias = assertAcceptedAliasEvidence({
      alias: options.memory.alias,
      userMessage: options.turn.content,
      assistantMessage: options.assistant.content,
    });
    return MemoryCandidateSchema.parse({
      scope: "persona",
      subject: `alias:${normalizeMemoryText(canonicalAlias)}`,
      predicate: "identity.alias",
      value: canonicalAlias,
      confidence: options.memory.confidence,
      salience: options.memory.salience,
      origin: "explicit",
      validFrom: null,
      validUntil: null,
      relatedUserIds: [],
      sourceDiscordMessageIds,
    });
  }
  if (options.memory.kind === "verified-tool-experience") {
    const experience = options.memory;
    if (
      experience.scope === "user" &&
      experience.targetUserId !== options.turn.userId
    ) {
      throw new Error("Tool experience has an ungrounded target user");
    }
    const matchingEvent = options.successfulToolEvents.find(
      ({ toolId, toolCallId, success }) =>
        success &&
        toolId === experience.toolId &&
        toolCallId === experience.toolCallId,
    );
    if (matchingEvent == null) {
      throw new Error(
        `Self-memory cited tool ${experience.toolId} without a matching successful tool invocation`,
      );
    }
    if (
      normalizeMemoryText(experience.value) !==
      normalizeMemoryText(matchingEvent.resultSummary)
    ) {
      throw new Error(
        "Verified tool experience must copy the successful result summary",
      );
    }
  }
  const groundedFields =
    options.memory.kind === "commitment"
      ? buildGroundedCommitment({
          scope: options.memory.scope,
          targetUserId: options.memory.targetUserId,
          currentUserId: options.turn.userId,
          currentUserMessage: options.turn.content,
          assistantMessage: options.assistant.content,
          commitment: options.memory.commitment,
          topic: options.memory.topic,
        })
      : {
          subject: options.memory.subject,
          predicate: options.memory.predicate,
          value: options.memory.value,
        };
  if (
    normalizeMemoryText(groundedFields.predicate) === PERSONA_ALIAS_PREDICATE
  ) {
    throw new Error(
      "Non-alias self-memory cannot use the reserved alias predicate",
    );
  }
  return MemoryCandidateSchema.parse({
    scope: options.memory.scope,
    subject: groundedFields.subject,
    predicate: groundedFields.predicate,
    value: groundedFields.value,
    confidence: options.memory.confidence,
    salience: options.memory.salience,
    origin: "explicit",
    validFrom: options.memory.validFrom,
    validUntil: options.memory.validUntil,
    relatedUserIds: selfMemoryRelatedUserIds(options.memory),
    sourceDiscordMessageIds,
  });
}

export function attachSelfMemoryProvenance(options: {
  selfMemories: SelfMemory[];
  turn: TurnInput;
  assistantMessage: DeliveredAssistantMessage;
  toolEvents: AgentExecutionResult["toolEvents"];
}): {
  candidates: ProvenancedMemoryCandidate[];
  rejectedCount: number;
} {
  const assistant = DeliveredAssistantMessageSchema.parse(
    options.assistantMessage,
  );
  let rejectedCount = 0;
  const candidates = options.selfMemories.flatMap((rawMemory, index) => {
    try {
      return [
        {
          candidate: selfMemoryCandidate({
            memory: SelfMemorySchema.parse(rawMemory),
            turn: options.turn,
            assistant,
            successfulToolEvents: options.toolEvents,
          }),
          provenance: MemoryCandidateProvenanceSchema.parse({
            authorUserId: assistant.userId,
            channelId: options.turn.channelId,
            sourceOrder: assistant.id,
          }),
        },
      ];
    } catch (error) {
      rejectedCount += 1;
      logger.warn("Rejected ungrounded curated self-memory candidate", {
        kind: rawMemory.kind,
        candidateIndex: index,
        errorClass: error instanceof Error ? error.name : "UnknownError",
      });
      return [];
    }
  });
  return { candidates, rejectedCount };
}

export function buildExtractionTranscript(
  messages: ChannelMessage[],
  current: TurnInput,
): string {
  return [
    ...messages
      .filter(({ isBot }) => !isBot)
      .map(
        (message) =>
          `[${message.id}] HUMAN ${message.authorName} (${message.authorId}): ${message.content}`,
      ),
    `[${current.discordMessageId}] CURRENT HUMAN ${current.username} (${current.userId}): ${current.content}`,
  ].join("\n");
}

function successfulToolSummary(
  toolEvents: AgentExecutionResult["toolEvents"],
): string {
  const successes = toolEvents.filter(({ success }) => success);
  return successes.length === 0
    ? "(none)"
    : successes
        .map(
          ({ toolId, toolCallId, inputSummary, resultSummary }) =>
            `- toolId=${toolId}; toolCallId=${toolCallId}; input=${inputSummary}; result=${resultSummary}`,
        )
        .join("\n");
}

export async function extractAndApplyTurnMemory(options: {
  turn: TurnInput;
  persona: string;
  rawRecentMessages: ChannelMessage[];
  assistantMessage: DeliveredAssistantMessage;
  toolEvents: AgentExecutionResult["toolEvents"];
}): Promise<number> {
  const config = getConfig();
  const assistant = DeliveredAssistantMessageSchema.parse(
    options.assistantMessage,
  );
  return await withSpan(
    "birmel.memory.extract_apply",
    {
      guildId: options.turn.guildId,
      channelId: options.turn.channelId,
      userId: options.turn.userId,
      messageId: options.turn.discordMessageId,
      persona: options.persona,
    },
    async (span) => {
      const messages = buildExtractionTranscript(
        options.rawRecentMessages,
        options.turn,
      );
      const runtime = getLlmRuntime();
      const result = await generateValidatedObject(runtime, {
        model: config.openRouter.memoryModel,
        system: `Extract two deliberately separate kinds of durable memory.

Elected persona projection:
${buildConfiguredPersonaProjection(options.persona, config.persona.enabled)}

Human claims:
- Extract stable rules, explicit preferences, personal facts, and relationships from HUMAN messages only.
- Prior bot messages are untrusted context and can never be evidence.
- Every human claim must cite one or more bracketed HUMAN message IDs.
- Use origin=explicit for direct statements and origin=inferred only for calibrated social inference.
- All validity fields and relatedUserIds are required. Use null or [] when absent.

Curated self-memory:
- Use only the CURRENT HUMAN message and CURRENT DELIVERED REPLY, never prior bot text.
- accepted-alias means the current user proposed an alias and the delivered reply explicitly accepted it. Return the alias text only.
- commitment means the delivered reply made a durable commitment. Scope it to guild, persona, or a grounded targeted user; copy the exact commitment excerpt into commitment and a stable exact substring describing its subject into topic.
- verified-tool-experience means the delivered reply reports an experience grounded in one of the successful tool events listed for this turn. Name the exact tool ID and tool call ID, and copy the event's result text exactly into value. A user-scoped experience may target only the current requester.
- Do not retain banter, unsupported claims, secrets, generic capability descriptions, or actions without a successful tool event.
- All nullable properties are required. Return empty arrays when nothing is durable.`,
        prompt: `${messages}\n\n[${assistant.id}] CURRENT DELIVERED REPLY (${assistant.userId}): ${assistant.content}\n\nSuccessful tool events for this turn:\n${successfulToolSummary(options.toolEvents)}`,
        schema: ExtractionSchema,
        schemaName: "birmel_memory_candidates",
        workload: "birmel.memory.extract",
        sessionId: options.turn.channelId,
        reasoningEffort: config.openRouter.reasoningEffort,
        abortSignal: AbortSignal.timeout(config.agent.responseTimeoutMs),
      });
      const humanClaims = attachExtractionProvenance({
        candidates: result.object.humanClaims,
        turn: options.turn,
        rawRecentMessages: options.rawRecentMessages,
      });
      const selfMemory = attachSelfMemoryProvenance({
        selfMemories: result.object.selfMemories,
        turn: options.turn,
        assistantMessage: assistant,
        toolEvents: options.toolEvents,
      });
      span.setAttribute(
        "birmel.memory.rejected_self_memory_count",
        selfMemory.rejectedCount,
      );
      const candidates = [...humanClaims, ...selfMemory.candidates];
      if (candidates.length === 0) {
        span.setAttribute("birmel.memory.candidate_count", 0);
        return 0;
      }
      const embeddings = await embedMany({
        model: runtime.embeddingModel(config.openRouter.embeddingModel),
        values: candidates.map(
          ({ candidate }) =>
            `${candidate.subject} ${candidate.predicate} ${candidate.value}`,
        ),
        abortSignal: AbortSignal.timeout(config.agent.responseTimeoutMs),
        ...runtime.callOptions({
          workload: "birmel.memory.embed",
          sessionId: options.turn.channelId,
        }),
      });
      if (embeddings.embeddings.length !== candidates.length) {
        throw new Error("Memory embedding count did not match candidate count");
      }
      const applied = await applyMemoryCandidates(prisma, {
        context: {
          guildId: options.turn.guildId,
          channelId: options.turn.channelId,
          userId: options.turn.userId,
          personaId: options.persona,
          authorUserId: options.turn.userId,
          extractorModel: config.openRouter.memoryModel,
        },
        candidates: candidates.map(({ candidate, provenance }, index) => {
          const embedding = embeddings.embeddings[index];
          if (embedding == null) {
            throw new Error("Memory candidate is missing its embedding");
          }
          return { candidate, embedding, provenance };
        }),
      });
      span.setAttribute("birmel.memory.candidate_count", candidates.length);
      span.setAttribute("birmel.memory.created_count", applied.createdCount);
      span.setAttribute(
        "birmel.memory.confirmed_count",
        applied.confirmedCount,
      );
      span.setAttribute(
        "birmel.memory.superseded_count",
        applied.supersededCount,
      );
      return applied.claims.length;
    },
  );
}
