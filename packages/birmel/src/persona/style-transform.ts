import path from "node:path";
import { z } from "zod";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { logger } from "@shepherdjerred/birmel/utils/logger.ts";

const StyleCardSchema = z.object({
  author: z.string(),
  voice: z.array(z.string()),
  style_markers: z.array(z.string()),
  personality: z.array(z.string()),
  humor_or_tone: z.array(z.string()),
  how_to_mimic: z.array(z.string()),
  sample_messages: z.array(z.string()),
  summary: z.string(),
});

export type StyleCard = z.infer<typeof StyleCardSchema>;

export type StyleContext = {
  persona: string;
  styleCard: StyleCard;
};

async function loadStyleCard(persona: string): Promise<StyleCard | null> {
  const cardPath = path.join(
    import.meta.dir,
    "style-cards",
    `${persona.toLowerCase()}_style.json`,
  );

  const file = Bun.file(cardPath);
  if (!(await file.exists())) {
    logger.debug("No style card found for persona", { persona, cardPath });
    return null;
  }

  try {
    const content = await file.text();
    const parsed: unknown = JSON.parse(content);
    const result = StyleCardSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }
    return null;
  } catch (error) {
    logger.error("Failed to load style card", { persona, error });
    return null;
  }
}

export async function buildStyleContext(
  persona: string,
): Promise<StyleContext | null> {
  const config = getConfig();

  if (!config.persona.enabled) {
    return null;
  }

  const styleCard = await loadStyleCard(persona);

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
export async function buildPersonaPrompt(persona: string): Promise<{
  name: string;
  voice: string;
  markers: string;
  samples: string[];
} | null> {
  const styleContext = await buildStyleContext(persona);
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
