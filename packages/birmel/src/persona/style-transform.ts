import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getConfig } from "../config/index.js";
import { logger } from "../utils/index.js";
import {
  getPersonaByUsername,
  getRandomMessages,
  type PersonaMessage,
} from "./database.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type StyleCard = {
  author: string;
  voice: string[];
  style_markers: string[];
  personality: string[];
  humor_or_tone: string[];
  how_to_mimic: string[];
  sample_messages: string[];
  summary: string;
};

export type StyleContext = {
  persona: string;
  exampleMessages: PersonaMessage[];
  styleCard: StyleCard | null;
};

function loadStyleCard(persona: string): StyleCard | null {
  const cardPath = join(
    __dirname,
    "style-cards",
    `${persona.toLowerCase()}_style.json`,
  );

  if (!existsSync(cardPath)) {
    logger.debug("No style card found for persona", { persona, cardPath });
    return null;
  }

  try {
    const content = readFileSync(cardPath, "utf-8");
    return JSON.parse(content) as StyleCard;
  } catch (error) {
    logger.error("Failed to load style card", { persona, error });
    return null;
  }
}

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

  const exampleMessages = getRandomMessages(
    personaUser.id,
    config.persona.styleExampleCount,
  );

  const styleCard = loadStyleCard(persona);

  logger.debug("Built style context", {
    persona,
    exampleCount: exampleMessages.length,
    hasStyleCard: !!styleCard,
  });

  return {
    persona,
    exampleMessages,
    styleCard,
  };
}

function formatStylePrompt(
  context: StyleContext,
  originalMessage: string,
): string {
  const { styleCard, exampleMessages, persona } = context;

  if (styleCard) {
    const voice = styleCard.voice.slice(0, 4).join("\n- ");
    const styleMarkers = styleCard.style_markers.slice(0, 4).join("\n- ");
    const howToMimic = styleCard.how_to_mimic.slice(0, 6).join("\n- ");
    const sampleMessages = styleCard.sample_messages
      .slice(0, 8)
      .map((m) => `"${m}"`)
      .join("\n");

    return `You are a style transformer. Rewrite the following message to match ${persona}'s writing style. Keep the EXACT same meaning and content, but change the tone, vocabulary, and sentence structure.

## ${persona}'s Style Profile

**Summary:** ${styleCard.summary}

**Voice:**
- ${voice}

**Style Markers:**
- ${styleMarkers}

**How to Write Like ${persona}:**
- ${howToMimic}

**Sample Messages:**
${sampleMessages}

---

**Original message to restyle:**
${originalMessage}

**Instructions:**
- Absorb the style, don't copy messages verbatim
- Match their typical message length, punctuation, and casing
- Keep all factual content from the original
- Output ONLY the restyled message with no quotes or explanation`;
  }

  // Fallback to example messages only
  const exampleList = exampleMessages.map((m) => `- "${m.content}"`).join("\n");

  return `You are a style transformer. Rewrite the following message to match this person's writing style. Keep the EXACT same meaning and content, but change the tone, vocabulary, and sentence structure.

Target style (examples from ${persona}):
${exampleList}

Key style notes:
- Use similar slang, abbreviations, and expressions as shown in the examples
- Match their typical message length and punctuation style
- Keep their personality quirks and humor
- DO NOT copy messages verbatim, just absorb the style
- Preserve all factual content and meaning from the original

Original message to restyle:
${originalMessage}

Rewrite in ${persona}'s voice. Output ONLY the restyled message with NO quotes around it and NO explanation:`;
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
  if (!styleContext || (!styleContext.styleCard && styleContext.exampleMessages.length === 0)) {
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
