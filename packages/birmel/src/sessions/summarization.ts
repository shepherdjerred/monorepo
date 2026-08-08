import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { getOpenAIProviderOptions } from "@shepherdjerred/birmel/agent-runtime/provider-options.ts";
import { withSpan } from "@shepherdjerred/birmel/observability/tracing.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { z } from "zod";

const MAX_RECENT_EVENTS = 16;
export const MAX_SESSION_SUMMARIZATION_EVENTS_PER_PASS = 64;
export const MAX_SESSION_SUMMARY_CHARACTERS = 8000;
export const MAX_SESSION_SUMMARIZATION_INPUT_CHARACTERS = 40_000;
const SessionSummarySchema = z
  .string()
  .min(1)
  .max(MAX_SESSION_SUMMARY_CHARACTERS);
const logger = loggers.agent.child("sessions");

type SessionSummaryInput = {
  previousSummary: string | null;
  events: { sequence: number; role: string; content: string }[];
};

export type SessionSummarizer = (input: SessionSummaryInput) => Promise<string>;

export function renderSessionSummaryPrompt(input: SessionSummaryInput): string {
  return `${input.previousSummary == null ? "" : `Previous versioned summary:\n${input.previousSummary}\n\n`}Events:\n${input.events.map((event) => `${String(event.sequence)} ${event.role}: ${event.content}`).join("\n")}`;
}

const defaultSummarizer: SessionSummarizer = async (input) => {
  const config = getConfig();
  const result = await generateText({
    model: openai(config.openai.memoryModel),
    system:
      "Summarize the durable state of this Discord work thread. Preserve decisions, unresolved work, user intent, and verified tool outcomes. Do not include reasoning or invent facts.",
    prompt: renderSessionSummaryPrompt(input),
    maxOutputTokens: 1500,
    timeout: config.agent.responseTimeoutMs,
    providerOptions: getOpenAIProviderOptions(),
  });
  return result.text;
};

export async function summarizeSessionIfNeeded(
  sessionId: string,
  summarizer: SessionSummarizer = defaultSummarizer,
): Promise<boolean> {
  const session = await prisma.agentSession.findUniqueOrThrow({
    where: { id: sessionId },
  });
  const pendingCount = await prisma.agentSessionEvent.count({
    where: {
      sessionId,
      sequence: { gt: session.summaryThroughSequence },
    },
  });
  if (pendingCount <= MAX_RECENT_EVENTS) {
    return false;
  }

  const pending = await prisma.agentSessionEvent.findMany({
    where: {
      sessionId,
      sequence: { gt: session.summaryThroughSequence },
    },
    orderBy: { sequence: "asc" },
    take: Math.min(
      pendingCount - MAX_RECENT_EVENTS,
      MAX_SESSION_SUMMARIZATION_EVENTS_PER_PASS,
    ),
  });

  const boundedPreviousSummary = session.summary?.slice(
    0,
    MAX_SESSION_SUMMARY_CHARACTERS,
  );
  const summarizedEvents: typeof pending = [];
  for (const event of pending) {
    const proposedEvents = [...summarizedEvents, event];
    if (
      renderSessionSummaryPrompt({
        previousSummary: boundedPreviousSummary ?? null,
        events: proposedEvents,
      }).length > MAX_SESSION_SUMMARIZATION_INPUT_CHARACTERS
    ) {
      break;
    }
    summarizedEvents.push(event);
  }
  const through = summarizedEvents.at(-1);
  if (through == null) {
    return false;
  }
  const summary = await withSpan(
    "birmel.session.summarize",
    { guildId: session.guildId, channelId: session.threadId },
    async () =>
      await summarizer({
        previousSummary: boundedPreviousSummary ?? null,
        events: summarizedEvents.map(({ sequence, role, content }) => ({
          sequence,
          role,
          content,
        })),
      }),
  );
  const parsedSummary = SessionSummarySchema.parse(summary);
  const updated = await prisma.agentSession.updateMany({
    where: {
      id: session.id,
      summaryVersion: session.summaryVersion,
      summaryThroughSequence: session.summaryThroughSequence,
    },
    data: {
      summary: parsedSummary,
      summaryVersion: { increment: 1 },
      summaryThroughSequence: through.sequence,
    },
  });
  if (updated.count === 0) {
    logger.info("Agent session summary lost a concurrent update race", {
      sessionId: session.id,
      guildId: session.guildId,
      throughSequence: through.sequence,
    });
    return false;
  }
  logger.info("Agent session summary advanced", {
    sessionId: session.id,
    guildId: session.guildId,
    summarizedEventCount: summarizedEvents.length,
    throughSequence: through.sequence,
    nextSummaryVersion: session.summaryVersion + 1,
  });
  return true;
}
