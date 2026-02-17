import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig } from "../config/index.js";
import { logger } from "../utils/index.js";

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
  styleCard: StyleCard;
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

  const styleCard = loadStyleCard(persona);

  if (!styleCard) {
    logger.warn("No style card available for persona", { persona });
    return null;
  }

  logger.debug("Built style context", {
    persona,
    hasStyleCard: true,
  });

  return {
    persona,
    styleCard,
  };
}

function formatStylePrompt(
  context: StyleContext,
  originalMessage: string,
): string {
  const { styleCard, persona } = context;

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

/**
 * Build persona context for prompt-embedded styling.
 * This returns a format suitable for injecting into the system prompt.
 */
export function buildPersonaPrompt(persona: string): {
  name: string;
  voice: string;
  markers: string;
  samples: string[];
} | null {
  const styleContext = buildStyleContext(persona);
  if (!styleContext) {
    return null;
  }

  const { styleCard } = styleContext;

  return {
    name: persona,
    voice: styleCard.voice
      .slice(0, 4)
      .map((v) => `- ${v}`)
      .join("\n"),
    markers: styleCard.style_markers
      .slice(0, 4)
      .map((m) => `- ${m}`)
      .join("\n"),
    samples: styleCard.sample_messages.slice(0, 10),
  };
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
  if (!styleContext) {
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
