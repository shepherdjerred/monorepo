import {
  SpecialistTaskPacketSchema,
  type ContextBundle,
  type RouteDecision,
  type SpecialistTaskPacket,
  type TurnInput,
} from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import {
  executeDirect,
  executeSpecialist,
  type AgentExecutionResult,
  type DirectExecutor,
  type SpecialistExecutor,
} from "./specialists.ts";

export type RuntimeDependencies = {
  direct: DirectExecutor;
  specialist: SpecialistExecutor;
};

const defaultDependencies: RuntimeDependencies = {
  direct: executeDirect,
  specialist: executeSpecialist,
};

function relevantContext(bundle: ContextBundle): string {
  return bundle.sources
    .filter(({ kind }) => kind !== "system-policy" && kind !== "persona")
    .map(({ content }) => content)
    .join("\n");
}

export function createSpecialistTaskPacket(options: {
  turn: TurnInput;
  context: ContextBundle;
  personaId: string;
  persona: string;
}): SpecialistTaskPacket {
  return SpecialistTaskPacketSchema.parse({
    request: options.turn.content,
    guildId: options.turn.guildId,
    channelId: options.turn.channelId,
    ...(options.turn.threadId == null
      ? {}
      : { threadId: options.turn.threadId }),
    userId: options.turn.userId,
    username: options.turn.username,
    personaId: options.personaId,
    persona: options.persona,
    context: relevantContext(options.context),
    attachments: options.turn.attachments,
  });
}

export async function executeRoutedTurn(options: {
  turn: TurnInput;
  context: ContextBundle;
  personaId: string;
  persona: string;
  route: RouteDecision;
  dependencies?: RuntimeDependencies;
}): Promise<AgentExecutionResult> {
  const dependencies = options.dependencies ?? defaultDependencies;
  const packet = createSpecialistTaskPacket(options);
  return options.route.route === "direct"
    ? await dependencies.direct(packet)
    : await dependencies.specialist(options.route.route, packet);
}
