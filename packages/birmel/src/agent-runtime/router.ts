import { openai } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import {
  RouteDecisionSchema,
  type ContextBundle,
  type RouteDecision,
  type TurnInput,
} from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { withSpan } from "@shepherdjerred/birmel/observability/tracing.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { getOpenAIProviderOptions } from "./provider-options.ts";
import { ROUTER_INSTRUCTIONS } from "./prompts.ts";

const logger = loggers.agent.child("router");

export type RouteRequest = {
  turn: TurnInput;
  personaId?: string;
  persona: string;
  context: ContextBundle;
};

export type RouteModel = (request: RouteRequest) => Promise<unknown>;

async function defaultRouteModel(request: RouteRequest): Promise<unknown> {
  const config = getConfig();
  const result = await generateText({
    model: openai(config.openai.classifierModel),
    system: ROUTER_INSTRUCTIONS,
    prompt: `Elected persona:\n${request.persona}\n\nCurrent request:\n${request.turn.content}\n\nRelevant context:\n${request.context.assembled}`,
    output: Output.object({
      schema: RouteDecisionSchema,
      name: "birmel_route_decision",
    }),
    timeout: config.agent.routerTimeoutMs,
    providerOptions: getOpenAIProviderOptions(),
  });
  return result.output;
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
      const decision = RouteDecisionSchema.parse(await routeModel(request));
      span.setAttribute("birmel.route", decision.route);
      span.setAttribute("birmel.route_confidence", decision.confidence);
      logger.info("Birmel turn routed", {
        messageId: request.turn.discordMessageId,
        route: decision.route,
        confidence: decision.confidence,
        personaId: request.personaId ?? "unknown",
      });
      return decision;
    },
  );
}
