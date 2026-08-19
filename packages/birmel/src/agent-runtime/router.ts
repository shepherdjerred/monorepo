import { generateValidatedObject } from "@shepherdjerred/llm-runtime";
import {
  RouteDecisionSchema,
  type ContextBundle,
  type RouteDecision,
  type TurnInput,
} from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import {
  getCapabilityCatalog,
  type CapabilityCatalogEntry,
} from "@shepherdjerred/birmel/agent-tools/tools/tool-sets.ts";
import { withSpan } from "@shepherdjerred/birmel/observability/tracing.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { getLlmRuntime } from "./llm.ts";
import { ROUTER_INSTRUCTIONS } from "./prompts.ts";

const logger = loggers.agent.child("router");

function formatCapabilityCatalog(catalog: CapabilityCatalogEntry[]): string {
  const formatted = catalog
    .map(
      ({ id, specialist, riskClass, description }) =>
        `- ${id} [${specialist}; ${riskClass}]: ${description}`,
    )
    .join("\n");
  if (formatted.length > 12_000) {
    throw new Error("Birmel capability catalog exceeds its router budget");
  }
  return formatted;
}

function validateCapabilityDecision(
  decision: RouteDecision,
  catalog: CapabilityCatalogEntry[],
): RouteDecision {
  if (decision.disposition !== "supported") {
    return decision;
  }
  const capability = catalog.find(({ id }) => id === decision.primaryToolId);
  if (capability == null) {
    throw new Error(
      `Router selected an unregistered primary tool: ${decision.primaryToolId ?? "null"}`,
    );
  }
  if (capability.specialist !== decision.route) {
    throw new Error(
      `Router selected ${decision.primaryToolId ?? "null"} for ${decision.route}, but ${capability.specialist} owns it`,
    );
  }
  return decision;
}

export type RouteRequest = {
  turn: TurnInput;
  personaId?: string;
  persona: string;
  context: ContextBundle;
};

export type RouteModel = (request: RouteRequest) => Promise<unknown>;

async function defaultRouteModel(request: RouteRequest): Promise<unknown> {
  const config = getConfig();
  const capabilityCatalog = getCapabilityCatalog();
  const result = await generateValidatedObject(getLlmRuntime(), {
    model: config.openRouter.classifierModel,
    system: ROUTER_INSTRUCTIONS,
    prompt: `Elected persona:\n${request.persona}\n\nRegistered capability catalog:\n${formatCapabilityCatalog(capabilityCatalog)}\n\nCurrent request:\n${request.turn.content}\n\nRelevant context:\n${request.context.assembled}`,
    schema: RouteDecisionSchema,
    schemaName: "birmel_route_decision",
    workload: "birmel.route",
    sessionId: request.turn.channelId,
    reasoningEffort: config.openRouter.reasoningEffort,
    abortSignal: AbortSignal.timeout(config.agent.routerTimeoutMs),
  });
  return result.object;
}

export async function routeTurn(
  request: RouteRequest,
  routeModel: RouteModel = defaultRouteModel,
): Promise<RouteDecision> {
  return await withSpan(
    "birmel.route",
    {
      guildId: request.turn.guildId,
      channelId: request.turn.channelId,
      userId: request.turn.userId,
      messageId: request.turn.discordMessageId,
      triggerKind: request.turn.triggerKind,
      sourceCharacters: request.context.sizes.total,
    },
    async (span) => {
      const decision = validateCapabilityDecision(
        RouteDecisionSchema.parse(await routeModel(request)),
        getCapabilityCatalog(),
      );
      span.setAttribute("birmel.route", decision.route);
      span.setAttribute("birmel.route_disposition", decision.disposition);
      if (decision.primaryToolId !== null) {
        span.setAttribute("birmel.primary_tool_id", decision.primaryToolId);
      }
      span.setAttribute("birmel.route_confidence", decision.confidence);
      logger.info("Birmel turn routed", {
        messageId: request.turn.discordMessageId,
        route: decision.route,
        disposition: decision.disposition,
        primaryToolId: decision.primaryToolId,
        confidence: decision.confidence,
        personaId: request.personaId ?? "unknown",
      });
      return decision;
    },
  );
}
