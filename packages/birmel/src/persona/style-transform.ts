// eslint-disable-next-line no-restricted-imports -- readFileSync/existsSync have no sync Bun equivalents
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { logger } from "@shepherdjerred/birmel/utils/index.ts";

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
  const cardPath = path.join(
    import.meta.dir,
    "style-cards",
    `${persona.toLowerCase()}_style.json`,
  );

  if (!existsSync(cardPath)) {
    logger.debug("No style card found for persona", { persona, cardPath });
    return null;
  }

  try {
    const content = readFileSync(cardPath, "utf8");
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

  if (styleCard == null) {
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
  if (styleContext == null) {
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
