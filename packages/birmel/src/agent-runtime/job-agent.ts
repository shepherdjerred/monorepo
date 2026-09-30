import { z } from "zod";
import { TaskPacketSchema } from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import { executeIsolatedAgent } from "@shepherdjerred/birmel/agent-runtime/agent.ts";
import { getGuildPersona } from "@shepherdjerred/birmel/persona/guild-persona.ts";
import type { AgentJobExecution } from "@shepherdjerred/birmel/scheduler/agent-job-delivery.ts";
import { getSessionContext } from "@shepherdjerred/birmel/sessions/service.ts";
import type { IsolatedAgentOptions } from "@shepherdjerred/birmel/agent-runtime/agent.ts";
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
    packet: z.infer<typeof TaskPacketSchema>,
    options: IsolatedAgentOptions,
  ) => ReturnType<typeof executeIsolatedAgent>;
  getPersona: (guildId: string) => Promise<string>;
  getSession: (sessionId: string) => Promise<JobSessionContext>;
};

const defaultDependencies: IsolatedJobAgentDependencies = {
  executeAgent: executeIsolatedAgent,
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
  const packet = TaskPacketSchema.parse({
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
  const failedToolEvents = result.toolEvents.filter((event) => !event.success);
  // A failure whose external effect is not provably absent must never be
  // replayed in place, even if the agent went on to succeed another way: we
  // cannot tell whether the first attempt landed. "unknown" leaves the
  // checkpoint intact so the job pauses for operator resolution.
  const unresolvedFailures = failedToolEvents.filter(
    (event) => event.effectDisposition !== "not_applied",
  );
  // Everything else is a failure the agent provably recovered from. Trying a
  // tool, seeing it fail with no effect, and succeeding another way is an
  // ordinary path through a turn now, so it must not fail the job - doing so
  // cleared the checkpoint and retried work that had already succeeded.
  // A run that failed without applying anything and did not go on to perform
  // the work still fails, which is safe to retry precisely because nothing
  // was applied.
  const recoveredWithoutEffect =
    unresolvedFailures.length === 0 &&
    failedToolEvents.length > 0 &&
    result.disposition !== "supported";
  const effectDisposition =
    unresolvedFailures.length > 0
      ? "unknown"
      : recoveredWithoutEffect
        ? "not_applied"
        : undefined;
  const reportedFailureToolIds = (
    unresolvedFailures.length > 0 ? unresolvedFailures : failedToolEvents
  ).map((event) => event.toolId);
  return {
    message:
      effectDisposition == null
        ? result.text
        : `Isolated scheduled agent tool execution failed: ${reportedFailureToolIds.join(", ")}`,
    data: {
      finishReason: result.finishReason,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      stepCount: result.stepCount,
      ...(effectDisposition == null ? {} : { effectDisposition }),
    },
  };
}
