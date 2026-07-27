import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { logger } from "@shepherdjerred/birmel/utils/logger.ts";
import { getStyleCard } from "@shepherdjerred/glitter-context";
import type { StyleCard as SharedStyleCard } from "@shepherdjerred/glitter-context/schema";

export type StyleContext = {
  persona: string;
  styleCard: SharedStyleCard;
};

function loadStyleCard(persona: string): SharedStyleCard | null {
  return getStyleCard(persona) ?? null;
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
