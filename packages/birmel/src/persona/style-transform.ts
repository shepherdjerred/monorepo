import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { logger } from "@shepherdjerred/birmel/utils/logger.ts";
import {
  getStyleCard,
  getStylePromptContext,
} from "@shepherdjerred/glitter-context";
import type {
  StyleCard as SharedStyleCard,
  StylePromptContext,
} from "@shepherdjerred/glitter-context/schema";

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
export type CompactPersonaContext = {
  format: "compact";
  name: string;
  voice: string;
  markers: string;
  samples: string[];
};

export type ThickPersonaContext = {
  format: "thick";
  name: string;
  style: StylePromptContext;
};

export type PersonaPromptContext = CompactPersonaContext | ThickPersonaContext;

export function buildPersonaPrompt(
  persona: string,
): PersonaPromptContext | null {
  const styleContext = buildStyleContext(persona);
  if (styleContext == null) {
    return null;
  }

  const { styleCard } = styleContext;
  const thickStyle = getStylePromptContext(persona);
  if (thickStyle !== undefined) {
    return {
      format: "thick",
      name: persona,
      style: thickStyle,
    };
  }

  return {
    format: "compact",
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
