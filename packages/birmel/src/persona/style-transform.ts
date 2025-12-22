import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { getConfig } from "../config/index.js";
import { logger } from "../utils/index.js";
import {
  getPersonaByUsername,
  getRandomMessages,
  type PersonaMessage,
} from "./database.js";

export type StyleContext = {
  persona: string;
  exampleMessages: PersonaMessage[];
};

export function buildStyleContext(persona: string): StyleContext | null {
  const config = getConfig();

  if (!config.persona.enabled) {
    return null;
  }

  const personaUser = getPersonaByUsername(persona);
  if (!personaUser) {
    logger.warn("Persona not found for style context", { persona });
    return null;
  }

  // Get random messages for style examples
  const exampleMessages = getRandomMessages(
    personaUser.id,
    config.persona.styleExampleCount,
  );

  logger.debug("Built style context", {
    persona,
    exampleCount: exampleMessages.length,
  });

  return {
    persona,
    exampleMessages,
  };
}

function formatStylePrompt(
  context: StyleContext,
  originalMessage: string,
): string {
  const exampleList = context.exampleMessages
    .map((m) => `- "${m.content}"`)
    .join("\n");

  return `You are a style transformer. Rewrite the following message to match this person's writing style. Keep the EXACT same meaning and content, but change the tone, vocabulary, and sentence structure.

Target style (examples from ${context.persona}):
${exampleList}

Key style notes:
- Use similar slang, abbreviations, and expressions as shown in the examples
- Match their typical message length and punctuation style
- Keep their personality quirks and humor
- DO NOT copy messages verbatim, just absorb the style
- Preserve all factual content and meaning from the original

Original message to restyle:
"${originalMessage}"

Rewrite in ${context.persona}'s voice (respond with ONLY the restyled message, no explanation):`;
}

export async function stylizeResponse(
  response: string,
  persona: string,
): Promise<string> {
  const config = getConfig();

  if (!config.persona.enabled) {
    return response;
  }

  const styleContext = buildStyleContext(persona);
  if (!styleContext || styleContext.exampleMessages.length === 0) {
    logger.debug("No style context available, returning original response");
    return response;
  }

  const prompt = formatStylePrompt(styleContext, response);

  try {
    const result = await generateText({
      model: openai(config.persona.styleModel),
      prompt,
    });

    logger.debug("Style transform complete", {
      persona,
      originalLength: response.length,
      styledLength: result.text.length,
    });

    return result.text;
  } catch (error) {
    logger.error("Style transform failed, returning original response", {
      error,
    });
    return response;
  }
}
