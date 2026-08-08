import { openai } from "@ai-sdk/openai";
import { embedMany, generateText, Output } from "ai";
import { z } from "zod";
import {
  MemoryCandidateSchema,
  type MemoryCandidate,
  type TurnInput,
} from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import { getOpenAIProviderOptions } from "@shepherdjerred/birmel/agent-runtime/provider-options.ts";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import type { ChannelMessage } from "@shepherdjerred/birmel/discord/utils/channel-history.ts";
import { applyMemoryCandidates } from "@shepherdjerred/birmel/memory/apply.ts";
import {
  MemoryCandidateProvenanceSchema,
  type MemoryCandidateProvenance,
} from "@shepherdjerred/birmel/memory/schemas.ts";
import { withSpan } from "@shepherdjerred/birmel/observability/tracing.ts";
import { buildCompactPersonaProjection } from "@shepherdjerred/birmel/persona/projection.ts";

const ExtractionSchema = z.object({
  candidates: z.array(MemoryCandidateSchema).max(20),
});

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

  return options.candidates.map((rawCandidate) => {
    const candidate = MemoryCandidateSchema.parse(rawCandidate);
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
    return {
      candidate: resolvedCandidate,
      provenance: MemoryCandidateProvenanceSchema.parse({
        authorUserId: latestSource.authorUserId,
        channelId: latestSource.channelId,
        sourceOrder: latestSource.messageId,
      }),
    };
  });
}

function rawTranscript(messages: ChannelMessage[], current: TurnInput): string {
  return [
    ...messages.map(
      (message) =>
        `[${message.id}] ${message.authorName} (${message.authorId}): ${message.content}`,
    ),
    `[${current.discordMessageId}] ${current.username} (${current.userId}): ${current.content}`,
  ].join("\n");
}

export async function extractAndApplyTurnMemory(options: {
  turn: TurnInput;
  persona: string;
  rawRecentMessages: ChannelMessage[];
}): Promise<number> {
  const config = getConfig();
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
      const messages = rawTranscript(options.rawRecentMessages, options.turn);
      const result = await generateText({
        model: openai(config.openai.memoryModel),
        system: `Extract durable memory claims from raw Discord messages only.

Elected persona projection:
${buildCompactPersonaProjection(options.persona)}

Use that persona's social judgment, but never invent evidence. Extract stable rules, explicit preferences, personal facts, and relationships that will improve future conversation. Broad social and relationship inference is allowed, but inferred claims must use origin=inferred and calibrated confidence. Direct user statements use origin=explicit. Do not extract transient plans, secrets, or the assistant's own claims. Every sourceDiscordMessageIds entry must cite one or more bracketed raw message IDs. Use guild, channel, persona, user, or relationship scope appropriately. For user scope include the target Discord user ID in relatedUserIds; omit it only when the target is the cited statement's author. For relationship scope include at least two Discord user IDs. Return an empty candidate list when nothing is durable.`,
        prompt: messages,
        output: Output.object({
          schema: ExtractionSchema,
          name: "birmel_memory_candidates",
        }),
        timeout: config.agent.responseTimeoutMs,
        providerOptions: getOpenAIProviderOptions(),
      });
      const candidates = attachExtractionProvenance({
        candidates: result.output.candidates,
        turn: options.turn,
        rawRecentMessages: options.rawRecentMessages,
      });
      if (candidates.length === 0) {
        span.setAttribute("birmel.memory.candidate_count", 0);
        return 0;
      }
      const embeddings = await embedMany({
        model: openai.embedding(config.openai.embeddingModel),
        values: candidates.map(
          ({ candidate }) =>
            `${candidate.subject} ${candidate.predicate} ${candidate.value}`,
        ),
        abortSignal: AbortSignal.timeout(config.agent.responseTimeoutMs),
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
          extractorModel: config.openai.memoryModel,
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
