import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { getOpenAIProviderOptions } from "@shepherdjerred/birmel/agent-runtime/provider-options.ts";
import { withSpan } from "@shepherdjerred/birmel/observability/tracing.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";

const MAX_RECENT_EVENTS = 16;
const logger = loggers.agent.child("sessions");

export type SessionSummarizer = (input: {
  previousSummary: string | null;
  events: { sequence: number; role: string; content: string }[];
}) => Promise<string>;

const defaultSummarizer: SessionSummarizer = async (input) => {
  const config = getConfig();
  const result = await generateText({
    model: openai(config.openai.memoryModel),
    system:
      "Summarize the durable state of this Discord work thread. Preserve decisions, unresolved work, user intent, and verified tool outcomes. Do not include reasoning or invent facts.",
    prompt: `${input.previousSummary == null ? "" : `Previous versioned summary:\n${input.previousSummary}\n\n`}Events:\n${input.events.map((event) => `${String(event.sequence)} ${event.role}: ${event.content}`).join("\n")}`,
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
  const pending = await prisma.agentSessionEvent.findMany({
    where: {
      sessionId,
      sequence: { gt: session.summaryThroughSequence },
    },
    orderBy: { sequence: "asc" },
  });
  if (pending.length <= MAX_RECENT_EVENTS) {
    return false;
  }

  const summarizedEvents = pending.slice(0, pending.length - MAX_RECENT_EVENTS);
  const through = summarizedEvents.at(-1);
  if (through == null) {
    return false;
  }
  const summary = await withSpan(
    "birmel.session.summarize",
    { guildId: session.guildId, channelId: session.threadId },
    async () =>
      await summarizer({
        previousSummary: session.summary,
        events: summarizedEvents.map(({ sequence, role, content }) => ({
          sequence,
          role,
          content,
        })),
      }),
  );
  if (summary.length === 0) {
    throw new Error("Session summarizer returned an empty summary");
  }
  await prisma.agentSession.update({
    where: { id: session.id },
    data: {
      summary,
      summaryVersion: { increment: 1 },
      summaryThroughSequence: through.sequence,
    },
  });
  logger.info("Agent session summary advanced", {
    sessionId: session.id,
    guildId: session.guildId,
    summarizedEventCount: summarizedEvents.length,
    throughSequence: through.sequence,
    nextSummaryVersion: session.summaryVersion + 1,
  });
  return true;
}
