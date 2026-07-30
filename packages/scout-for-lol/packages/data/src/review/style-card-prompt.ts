import { styleCardToPromptContext } from "@shepherdjerred/glitter-context";
import type { StyleCard } from "@shepherdjerred/glitter-context/schema";

export function serializeStyleCardForScoutPrompt(styleCard: StyleCard): string {
  return JSON.stringify(styleCardToPromptContext(styleCard) ?? styleCard);
}
