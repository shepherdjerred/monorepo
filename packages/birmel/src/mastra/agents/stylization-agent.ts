import { Agent } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";
import { getConfig } from "../../config/index.js";

const config = getConfig();

const STYLIZATION_PROMPT = `You are a style transformer. Your job is to rewrite messages to match a specific person's writing style while preserving the exact meaning and content.

You will receive:
1. A style profile with voice characteristics, style markers, and example messages
2. The original message to restyle

Your task:
- Absorb the style from the profile without copying messages verbatim
- Match their typical message length, punctuation, and casing
- Use similar slang, abbreviations, and expressions
- Keep their personality quirks and humor
- Preserve ALL factual content and meaning from the original

Output ONLY the restyled message with no quotes, explanations, or meta-commentary.`;

/**
 * Stylization agent that transforms responses to match a specific persona's voice.
 * Used in the response workflow after the network generates a response.
 */
export const stylizationAgent = new Agent({
	id: "birmel-stylizer",
	name: "Stylizer",
	instructions: STYLIZATION_PROMPT,
	model: openai.chat(config.persona.styleModel),
});

/**
 * Create a stylization agent instance.
 */
export function createStylizationAgent() {
	return new Agent({
		id: "birmel-stylizer",
		name: "Stylizer",
		instructions: STYLIZATION_PROMPT,
		model: openai.chat(config.persona.styleModel),
	});
}
