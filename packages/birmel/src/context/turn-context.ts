import { openai } from "@ai-sdk/openai";
import { embed } from "ai";
import { getFriendContext } from "@shepherdjerred/glitter-context";
import {
  CONTEXT_BUDGETS,
  type ContextBundle,
  type TurnInput,
} from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import { CORE_SYSTEM_POLICY } from "@shepherdjerred/birmel/agent-runtime/prompts.ts";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { assembleContextBundle } from "@shepherdjerred/birmel/context/context-bundle.ts";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import {
  getConversationTranscriptResult,
  type TranscriptSource,
} from "@shepherdjerred/birmel/discord/utils/channel-history.ts";
import { retrieveMemoryClaims } from "@shepherdjerred/birmel/memory/retrieve.ts";
import { withSpan } from "@shepherdjerred/birmel/observability/tracing.ts";
import { buildConfiguredPersonaProjection } from "@shepherdjerred/birmel/persona/projection.ts";
import { getSessionContext } from "@shepherdjerred/birmel/sessions/service.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";

const logger = loggers.agent.child("context");

type TurnContextOptions = {
  turn: TurnInput;
  message: TranscriptSource;
  persona: string;
  sessionId?: string;
};

function mentionedDiscordUserIds(content: string): string[] {
  return [
    ...new Set(
      [...content.matchAll(/<@!?(\d{17,20})>/gu)].flatMap((match) => {
        const userId = match[1];
        return userId == null ? [] : [userId];
      }),
    ),
  ];
}

function explicitlyNamedFriendReferences(content: string): string[] {
  const references = new Set<string>();
  const addReference = (reference: string): void => {
    const trimmed = reference.trim();
    if (trimmed.length > 0) {
      references.add(trimmed);
    }
  };

  // Keep broad alias matching disabled: ordinary words such as "Google" and
  // "Mark" are also valid lore entries. CamelCase names/aliases and quoted
  // references are high-confidence explicit references that can be resolved
  // without scanning every alias against the whole message.
  for (const token of content.match(/[\p{L}\p{N}]+/gu) ?? []) {
    const uppercaseCount = token.match(/\p{Lu}/gu)?.length ?? 0;
    if (uppercaseCount >= 2) {
      addReference(token);
    }
  }
  for (const match of content.matchAll(/["“]([^"”]+)["”]/gu)) {
    const reference = match[1];
    if (reference !== undefined) {
      addReference(reference);
    }
  }
  return [...references];
}

async function queryEmbedding(content: string): Promise<number[] | null> {
  if (content.trim().length === 0) {
    return null;
  }
  const config = getConfig();
  try {
    const result = await embed({
      model: openai.embedding(config.openai.embeddingModel),
      value: content,
      abortSignal: AbortSignal.timeout(config.agent.routerTimeoutMs),
    });
    return result.embedding;
  } catch {
    // Embeddings are a ranking signal, not the source of truth. Lexical,
    // scope, confidence, salience, and recency ranking remain available.
    return null;
  }
}

function renderMemoryClaim(input: {
  claim: {
    subject: string;
    predicate: string;
    value: string;
    origin: string;
    confidence: number;
  };
  uncertain: boolean;
}): string {
  const uncertainty = input.uncertain ? " uncertain/conflicting" : "";
  return `${input.claim.subject} ${input.claim.predicate}: ${input.claim.value} [${input.claim.origin}, confidence ${input.claim.confidence.toFixed(2)}${uncertainty}]`;
}

async function assembleContextForTurn(
  options: TurnContextOptions,
): Promise<ContextBundle> {
  const config = getConfig();
  const mentioned = mentionedDiscordUserIds(options.turn.content);
  const explicitFriendReferences = explicitlyNamedFriendReferences(
    options.turn.content,
  );
  const userIds = [...new Set([options.turn.userId, ...mentioned])];
  const [transcript, embedding, sessionContext] = await Promise.all([
    getConversationTranscriptResult(options.message, {
      windowMs: config.responder.transcriptWindowMs,
      maxMessages: Math.min(
        config.responder.transcriptMaxMessages,
        CONTEXT_BUDGETS.transcriptFetchLimit,
      ),
    }),
    queryEmbedding(options.turn.content),
    options.sessionId == null
      ? Promise.resolve(undefined)
      : getSessionContext(options.sessionId),
  ]);
  const memory = await retrieveMemoryClaims(prisma, {
    guildId: options.turn.guildId,
    channelId: options.turn.channelId,
    personaId: options.persona,
    userIds,
    relationshipUserIds: userIds,
    query: options.turn.content,
    queryEmbedding: embedding,
    at: options.turn.receivedAt,
    limit: CONTEXT_BUDGETS.maximumClaims,
  });
  const friendContext = getFriendContext({
    message: options.turn.content,
    references: [...mentioned, ...explicitFriendReferences],
    mentionedDiscordUserIds: mentioned,
    resolveMessageAliases: false,
    characterBudget: CONTEXT_BUDGETS.loreAndMemory,
    maxLoreSections: 6,
  });

  return assembleContextBundle({
    systemPolicy: CORE_SYSTEM_POLICY,
    personaProjection: buildConfiguredPersonaProjection(
      options.persona,
      config.persona.enabled,
    ),
    currentMessage: {
      id: options.turn.discordMessageId,
      authorName: options.turn.username,
      isBot: false,
      content: options.turn.content,
      createdAt: options.turn.receivedAt,
    },
    transcript: transcript.messages,
    transcriptFetchFailed: transcript.fetchFailed,
    rankedFragments: [
      ...memory.claims.map((item) => ({
        id: `memory:${item.claim.id}`,
        kind: "memory" as const,
        content: renderMemoryClaim(item),
        rank: item.score + (item.mandatory ? 10 : 0),
        memoryClaimId: item.claim.id,
      })),
      ...(friendContext.contextText.length === 0
        ? []
        : [
            {
              id: "friend-context",
              kind: "lore" as const,
              content: friendContext.contextText,
              rank: 1,
            },
          ]),
    ],
    ...(sessionContext?.summary == null
      ? {}
      : { sessionSummary: sessionContext.summary }),
    sessionEvents:
      sessionContext?.events.map((event) => ({
        id: event.id,
        role:
          event.role === "user" || event.role === "assistant"
            ? event.role
            : "tool",
        content: event.content,
        sequence: event.sequence,
        createdAt: event.createdAt,
        ...(event.discordMessageId == null
          ? {}
          : { discordMessageId: event.discordMessageId }),
      })) ?? [],
  });
}

export async function buildContextForTurn(
  options: TurnContextOptions,
): Promise<ContextBundle> {
  return await withSpan(
    "birmel.context.construct",
    {
      guildId: options.turn.guildId,
      channelId: options.turn.channelId,
      userId: options.turn.userId,
      messageId: options.turn.discordMessageId,
      persona: options.persona,
    },
    async (span) => {
      const context = await assembleContextForTurn(options);
      span.setAttribute(
        "birmel.context.core_characters",
        context.sizes.coreInstructions,
      );
      span.setAttribute(
        "birmel.context.persona_characters",
        context.sizes.persona,
      );
      span.setAttribute(
        "birmel.context.memory_characters",
        context.sizes.loreAndMemory,
      );
      span.setAttribute(
        "birmel.context.transcript_characters",
        context.sizes.transcript,
      );
      span.setAttribute("birmel.context.total_characters", context.sizes.total);
      span.setAttribute(
        "birmel.context.selected_memory_count",
        context.selectedMemoryClaimIds.length,
      );
      span.setAttribute(
        "birmel.context.transcript_fetch_failed",
        context.transcriptFetchFailed,
      );
      logger.info("Context bundle constructed", {
        messageId: options.turn.discordMessageId,
        personaId: options.persona,
        ...context.sizes,
        selectedMemoryCount: context.selectedMemoryClaimIds.length,
        transcriptFetchFailed: context.transcriptFetchFailed,
      });
      return context;
    },
  );
}
