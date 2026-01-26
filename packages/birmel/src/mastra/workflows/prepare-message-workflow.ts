import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { buildStyleContext, type StyleContext } from "../../persona/index.js";
import { getGuildPersona } from "../../persona/index.js";
import { getConfig } from "../../config/index.js";
import { stylizationAgent } from "../agents/stylization-agent.js";
import { logger } from "../../utils/index.js";

/**
 * Input schema for the prepare-message workflow
 */
const workflowInputSchema = z.object({
	/** The message content to transform */
	content: z.string(),
	/** Guild ID for persona lookup */
	guildId: z.string(),
	/** Server memory (permanent rules) */
	serverMemory: z.string().optional(),
	/** Owner memory (current owner's preferences) */
	ownerMemory: z.string().optional(),
});

/**
 * Output schema for the prepare-message workflow
 */
const workflowOutputSchema = z.object({
	/** The transformed message content */
	content: z.string(),
	/** The persona used for styling */
	persona: z.string(),
	/** Whether styling was applied */
	wasStyled: z.boolean(),
});

/**
 * Step: Transform message content to match the guild owner's persona style
 */
const transformStep = createStep({
	id: "transform",
	inputSchema: workflowInputSchema,
	outputSchema: workflowOutputSchema,
	execute: async ({ inputData }) => {
		const config = getConfig();

		// If persona is disabled, return original content
		if (!config.persona.enabled) {
			logger.debug("Persona disabled, returning original content");
			return {
				content: inputData.content,
				persona: "",
				wasStyled: false,
			};
		}

		// Get the persona for this guild
		const persona = await getGuildPersona(inputData.guildId);

		logger.debug("Preparing message with style", {
			guildId: inputData.guildId,
			persona,
			contentLength: inputData.content.length,
		});

		// Build style context from style card
		const styleContext = buildStyleContext(persona);

		// If no style context available (no style card), return original content
		if (!styleContext) {
			logger.debug("No style context available, returning original content");
			return {
				content: inputData.content,
				persona,
				wasStyled: false,
			};
		}

		// Build the stylization prompt with memory context
		const stylizationPrompt = formatStylizationPrompt(
			styleContext,
			inputData.content,
			inputData.serverMemory,
			inputData.ownerMemory,
		);

		// Use the stylization agent
		const result = await stylizationAgent.generate(stylizationPrompt);

		logger.debug("Message prepared with style", {
			persona,
			originalLength: inputData.content.length,
			styledLength: result.text.length,
		});

		return {
			content: result.text,
			persona,
			wasStyled: true,
		};
	},
});

/**
 * Format the prompt for stylization
 */
function formatStylizationPrompt(
	context: StyleContext,
	originalMessage: string,
	serverMemory?: string,
	ownerMemory?: string,
): string {
	const { styleCard, persona } = context;

	const voice = styleCard.voice.slice(0, 4).join("\n- ");
	const styleMarkers = styleCard.style_markers.slice(0, 4).join("\n- ");
	const howToMimic = styleCard.how_to_mimic.slice(0, 6).join("\n- ");
	const sampleMessages = styleCard.sample_messages
		.slice(0, 8)
		.map((m) => `"${m}"`)
		.join("\n");

	// Build memory context section if any memory is present
	let memorySection = "";
	if (serverMemory || ownerMemory) {
		memorySection = "\n## Memory Context\nConsider these rules when styling:\n";
		if (serverMemory) {
			memorySection += `\n**Server Rules:**\n${serverMemory}\n`;
		}
		if (ownerMemory) {
			memorySection += `\n**Owner Rules:**\n${ownerMemory}\n`;
		}
	}

	return `Rewrite the following message to match ${persona}'s writing style. Keep the EXACT same meaning and content, but change the tone, vocabulary, and sentence structure.

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
${memorySection}
---

**Original message to restyle:**
${originalMessage}

**Instructions:**
- Absorb the style, don't copy messages verbatim
- Match their typical message length, punctuation, and casing
- Keep all factual content from the original
- Follow any rules from memory context (if present)
- Output ONLY the restyled message with no quotes or explanation`;
}

/**
 * Prepare message workflow.
 *
 * Transforms message content to match the guild owner's persona style.
 * Should be called before sending any message via Discord tools.
 */
export const prepareMessageWorkflow = createWorkflow({
	id: "prepare-message",
	inputSchema: workflowInputSchema,
	outputSchema: workflowOutputSchema,
})
	.then(transformStep)
	.commit();

export type PrepareMessageInput = z.infer<typeof workflowInputSchema>;
export type PrepareMessageOutput = z.infer<typeof workflowOutputSchema>;
