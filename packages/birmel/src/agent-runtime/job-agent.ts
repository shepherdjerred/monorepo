import { z } from "zod";
import { SpecialistTaskPacketSchema } from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import { executeIsolatedAutomationAgent } from "@shepherdjerred/birmel/agent-runtime/specialists.ts";
import { getGuildPersona } from "@shepherdjerred/birmel/persona/guild-persona.ts";
import type { AgentJobExecution } from "@shepherdjerred/birmel/scheduler/jobs/scheduled-tasks.ts";
import { getSessionContext } from "@shepherdjerred/birmel/sessions/service.ts";
import type { IsolatedAgentOptions } from "@shepherdjerred/birmel/agent-runtime/specialists.ts";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { buildConfiguredPersonaProjection } from "@shepherdjerred/birmel/persona/projection.ts";
import { MAX_SESSION_SUMMARY_CHARACTERS } from "@shepherdjerred/birmel/sessions/summarization.ts";

const ReasoningEffortSchema = z.enum(["minimal", "low", "medium", "high"]);
const TextVerbositySchema = z.enum(["low", "medium", "high"]);
const MAX_JOB_SESSION_CONTEXT_CHARACTERS = 20_000;

type JobSessionContext = {
  summary: string | undefined;
  events: { sequence: number; role: string; content: string }[];
};

export type IsolatedJobAgentDependencies = {
  executeAgent: (
    packet: z.infer<typeof SpecialistTaskPacketSchema>,
    options: IsolatedAgentOptions,
  ) => ReturnType<typeof executeIsolatedAutomationAgent>;
  getPersona: (guildId: string) => Promise<string>;
  getSession: (sessionId: string) => Promise<JobSessionContext>;
};

const defaultDependencies: IsolatedJobAgentDependencies = {
  executeAgent: executeIsolatedAutomationAgent,
  getPersona: getGuildPersona,
  getSession: getSessionContext,
};

async function jobSessionContext(
  sessionId: string | null,
  dependencies: IsolatedJobAgentDependencies,
): Promise<string> {
  if (sessionId == null) {
    return "";
  }
  const context = await dependencies.getSession(sessionId);
  const summary = context.summary?.slice(0, MAX_SESSION_SUMMARY_CHARACTERS);
  const selectedEvents: string[] = [];
  for (const event of context.events.toReversed()) {
    const rendered = `${String(event.sequence)} ${event.role}: ${event.content}`;
    const proposedEvents = [rendered, ...selectedEvents].join("\n");
    const proposed = [summary, proposedEvents]
      .filter((value) => value != null && value.length > 0)
      .join("\n\n");
    if (proposed.length <= MAX_JOB_SESSION_CONTEXT_CHARACTERS) {
      selectedEvents.unshift(rendered);
    }
  }
  return [summary, selectedEvents.join("\n")]
    .filter((value) => value != null && value.length > 0)
    .join("\n\n");
}

export async function executeIsolatedAgentJob(
  prompt: string,
  execution: AgentJobExecution,
  dependencies: IsolatedJobAgentDependencies = defaultDependencies,
): Promise<{ message: string; data: Record<string, unknown> }> {
  const personaId = await dependencies.getPersona(execution.guildId);
  const packet = SpecialistTaskPacketSchema.parse({
    request: prompt,
    guildId: execution.guildId,
    channelId: execution.requestContext.sourceChannelId,
    userId: execution.actorUserId,
    username: `trusted actor ${execution.actorUserId}`,
    personaId,
    persona: buildConfiguredPersonaProjection(
      personaId,
      getConfig().persona.enabled,
    ),
    context: await jobSessionContext(execution.sessionId, dependencies),
    attachments: [],
  });
  const result = await dependencies.executeAgent(packet, {
    ...(execution.model == null ? {} : { model: execution.model }),
    ...(execution.reasoningEffort == null
      ? {}
      : {
          reasoningEffort: ReasoningEffortSchema.parse(
            execution.reasoningEffort,
          ),
        }),
    ...(execution.textVerbosity == null
      ? {}
      : {
          textVerbosity: TextVerbositySchema.parse(execution.textVerbosity),
        }),
    timeoutMs: execution.timeoutMs,
  });
  const failedToolIds = result.toolEvents
    .filter((event) => !event.success)
    .map((event) => event.toolId);
  if (failedToolIds.length > 0) {
    throw new Error(
      `Isolated scheduled agent tool execution failed: ${failedToolIds.join(", ")}`,
    );
  }
  return {
    message: result.text,
    data: {
      finishReason: result.finishReason,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      stepCount: result.stepCount,
    },
  };
}
