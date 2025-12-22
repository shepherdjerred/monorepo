import { getConfig } from "../config/index.js";
import { logger } from "../utils/index.js";
import {
  getPersonaByUsername,
  getSimilarMessages,
  type PersonaMessage,
} from "./database.js";

export type DecisionContext = {
  persona: string;
  similarMessages: PersonaMessage[];
};

export function buildDecisionContext(
  persona: string,
  userQuery: string,
): DecisionContext | null {
  const config = getConfig();

  if (!config.persona.enabled) {
    return null;
  }

  const personaUser = getPersonaByUsername(persona);
  if (!personaUser) {
    logger.warn("Persona not found for decision context", { persona });
    return null;
  }

  // Find similar messages from the persona based on user's query
  const similarMessages = getSimilarMessages(
    personaUser.id,
    userQuery,
    config.persona.decisionExampleCount,
  );

  logger.debug("Built decision context", {
    persona,
    similarCount: similarMessages.length,
  });

  return {
    persona,
    similarMessages,
  };
}

export function formatDecisionPrompt(context: DecisionContext): string {
  if (context.similarMessages.length === 0) {
    return "";
  }

  const messageList = context.similarMessages
    .map((m) => `- "${m.content}"`)
    .join("\n");

  return `
## Decision Guidance

Here are similar messages from ${context.persona} that may help guide your response:

${messageList}

Use these examples to guide your decision-making - how direct to be, when to use humor, how to phrase things, etc.
`;
}
