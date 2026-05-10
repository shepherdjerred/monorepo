import { Agent, createSubagent } from "@voltagent/core";
import { openai } from "@ai-sdk/openai";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { createMemory } from "@shepherdjerred/birmel/voltagent/memory/index.ts";
import { OPENAI_RESPONSES_PROVIDER_OPTIONS } from "@shepherdjerred/birmel/voltagent/openai-provider-options.ts";
import { sanitizeReplayHook } from "@shepherdjerred/birmel/voltagent/agents/hooks.ts";
import {
  buildSupervisorPrompt,
  type PersonaContext,
} from "@shepherdjerred/birmel/voltagent/agents/system-prompt.ts";
import { createMessagingAgent } from "./specialized/messaging-agent.ts";
import { createServerAgent } from "./specialized/server-agent.ts";
import { createModerationAgent } from "./specialized/moderation-agent.ts";
import { createMusicAgent } from "./specialized/music-agent.ts";
import { createAutomationAgent } from "./specialized/automation-agent.ts";
import { createEditorAgent } from "./specialized/editor-agent.ts";

type ForwardedStreamEventType = "text-delta" | "tool-call" | "tool-result";

const FORWARDED_STREAM_EVENT_TYPES: ForwardedStreamEventType[] = [
  "text-delta",
  "tool-call",
  "tool-result",
];

const SUPERVISOR_CONFIG = {
  // Forward text-delta events from sub-agents for progressive streaming
  fullStreamEventForwarding: {
    types: FORWARDED_STREAM_EVENT_TYPES,
  },
};

/**
 * Wrap a sub-agent so the supervisor's `delegate_task` invocation passes the
 * OpenAI Responses provider options (store: false + reasoning encrypted_content)
 * through to the sub-agent's underlying `streamText` call. Without this,
 * sub-agents hit the same legacy reasoning-item-replay bug as the supervisor.
 */
function wrapWithStreamOptions(agent: Agent) {
  return createSubagent({
    agent,
    method: "streamText",
    options: {
      providerOptions: OPENAI_RESPONSES_PROVIDER_OPTIONS,
    },
  });
}

function buildSubAgents(persona: PersonaContext | null) {
  return [
    wrapWithStreamOptions(createMessagingAgent(persona)),
    wrapWithStreamOptions(createServerAgent(persona)),
    wrapWithStreamOptions(createModerationAgent(persona)),
    wrapWithStreamOptions(createMusicAgent(persona)),
    wrapWithStreamOptions(createAutomationAgent(persona)),
    wrapWithStreamOptions(createEditorAgent(persona)),
  ];
}

function buildRoutingAgent(persona: PersonaContext | null): Agent {
  const config = getConfig();
  return new Agent({
    name: "birmel-router",
    instructions: buildSupervisorPrompt(persona),
    model: openai(config.openai.model),
    subAgents: buildSubAgents(persona),
    supervisorConfig: SUPERVISOR_CONFIG,
    memory: createMemory(),
    hooks: {
      onPrepareMessages: sanitizeReplayHook,
      // Skip supervisor post-processing — return sub-agent result directly.
      // Persona is injected into each sub-agent so the user gets consistent
      // voice across delegation without a second LLM round-trip.
      onHandoffComplete: ({ bail }) => {
        bail();
      },
    },
  });
}

/**
 * Per-persona Agent cache. There are at most 10 personas (one per style card),
 * so this is bounded; a fresh entry costs ~7 Agent allocations (1 supervisor +
 * 6 sub-agents) but only happens once per persona ever.
 *
 * The `null` persona key handles the "persona disabled" / "no owner" case.
 */
const routerCache = new Map<string | null, Agent>();

function personaCacheKey(persona: PersonaContext | null): string | null {
  return persona?.name ?? null;
}

/**
 * Get a routing agent configured for the given persona, reusing a cached
 * instance when one already exists.
 */
export function getRoutingAgent(persona: PersonaContext | null): Agent {
  const key = personaCacheKey(persona);
  let cached = routerCache.get(key);
  if (cached == null) {
    cached = buildRoutingAgent(persona);
    routerCache.set(key, cached);
  }
  return cached;
}

/**
 * @deprecated kept for backwards compatibility — prefer {@link getRoutingAgent}.
 */
export function createRoutingAgentWithPersona(
  persona: PersonaContext | null,
): Agent {
  return getRoutingAgent(persona);
}

/**
 * Default no-persona router. Use {@link getRoutingAgent} when you have a
 * persona to inject.
 */
export const routingAgent = getRoutingAgent(null);
