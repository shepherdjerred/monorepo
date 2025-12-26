import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { parseClassificationResult } from "../agents/classifier-agent.js";
import { getClassifierAgent, getRoutingAgent } from "../index.js";
import { stylizationAgent } from "../agents/stylization-agent.js";
import { buildStyleContext, type StyleContext } from "../../persona/style-transform.js";
import { getGuildPersona } from "../../persona/guild-persona.js";
import { logger } from "../../utils/index.js";

/**
 * Input schema for the response workflow
 */
const workflowInputSchema = z.object({
	/** The message content to process */
	message: z.string(),
	/** Guild ID for persona lookup */
	guildId: z.string(),
	/** Channel ID for context */
	channelId: z.string(),
	/** User ID of the message author */
	userId: z.string(),
	/** Username of the message author */
	username: z.string(),
	/** Whether to run the classifier first */
	runClassifier: z.boolean().default(false),
	/** Recent conversation history for context */
	conversationHistory: z.string().optional(),
	/** Global memory/rules for the guild */
	globalMemory: z.string().optional(),
	/** Confidence threshold for classifier (default 0.7) */
	classifierThreshold: z.number().default(0.7),
});

/**
 * Output schema for the response workflow
 */
const workflowOutputSchema = z.object({
	/** Whether the bot should respond */
	shouldRespond: z.boolean(),
	/** The final stylized response */
	response: z.string(),
	/** Classification result if classifier was run */
	classification: z
		.object({
			shouldRespond: z.boolean(),
			reasoning: z.string(),
			confidence: z.number(),
		})
		.optional(),
	/** The raw response before stylization */
	rawResponse: z.string().optional(),
	/** The persona used for stylization */
	persona: z.string().optional(),
});

/**
 * Step 1: Classification (optional)
 * Determines if the bot should respond to the message
 */
const classifyStep = createStep({
	id: "classify",
	inputSchema: workflowInputSchema,
	outputSchema: z.object({
		shouldContinue: z.boolean(),
		classification: z
			.object({
				shouldRespond: z.boolean(),
				reasoning: z.string(),
				confidence: z.number(),
			})
			.optional(),
		originalInput: workflowInputSchema,
	}),
	execute: async ({ inputData }) => {
		// If classifier is disabled, always continue
		if (!inputData.runClassifier) {
			logger.debug("Classifier disabled, continuing to network");
			return {
				shouldContinue: true,
				classification: undefined,
				originalInput: inputData,
			};
		}

		logger.debug("Running classifier", {
			guildId: inputData.guildId,
			channelId: inputData.channelId,
		});

		const classifierAgent = getClassifierAgent();
		const classifierInput = inputData.conversationHistory
			? `${inputData.conversationHistory}\n\nNew message from ${inputData.username}: ${inputData.message}`
			: `New message from ${inputData.username}: ${inputData.message}`;

		const result = await classifierAgent.generate(classifierInput);
		const classification = parseClassificationResult(result.text);

		logger.debug("Classification result", {
			shouldRespond: classification.shouldRespond,
			confidence: classification.confidence,
			reasoning: classification.reasoning,
		});

		const shouldContinue =
			classification.shouldRespond &&
			classification.confidence >= inputData.classifierThreshold;

		return {
			shouldContinue,
			classification,
			originalInput: inputData,
		};
	},
});

/**
 * Step 2: Generate response via Agent Network
 * Routes the message through specialized agents
 */
const generateStep = createStep({
	id: "generate",
	inputSchema: z.object({
		shouldContinue: z.boolean(),
		classification: z
			.object({
				shouldRespond: z.boolean(),
				reasoning: z.string(),
				confidence: z.number(),
			})
			.optional(),
		originalInput: workflowInputSchema,
	}),
	outputSchema: z.object({
		shouldContinue: z.boolean(),
		classification: z
			.object({
				shouldRespond: z.boolean(),
				reasoning: z.string(),
				confidence: z.number(),
			})
			.optional(),
		rawResponse: z.string(),
		originalInput: workflowInputSchema,
	}),
	execute: async ({ inputData }) => {
		// If classifier said don't respond, skip generation
		if (!inputData.shouldContinue) {
			logger.debug("Skipping generation - classifier said not to respond");
			return {
				shouldContinue: false,
				classification: inputData.classification,
				rawResponse: "",
				originalInput: inputData.originalInput,
			};
		}

		const { originalInput } = inputData;

		logger.debug("Generating response via Agent Network", {
			guildId: originalInput.guildId,
			channelId: originalInput.channelId,
		});

		// Build the prompt with context
		const globalContext = originalInput.globalMemory
			? `\n## Server Rules & Memory\n${originalInput.globalMemory}\n`
			: "";
		const conversationContext = originalInput.conversationHistory
			? `\n## Recent Conversation\n${originalInput.conversationHistory}\n`
			: "";

		const prompt = `User ${originalInput.username} (ID: ${originalInput.userId}) in channel ${originalInput.channelId} says:

${originalInput.message}

Guild ID: ${originalInput.guildId}
Channel ID: ${originalInput.channelId}
${globalContext}${conversationContext}`;

		const routingAgent = getRoutingAgent();
		let responseText = "";

		// Use Agent Network
		const networkStream = await routingAgent.network(prompt);

		for await (const chunk of networkStream) {
			if (
				chunk.type === "network-execution-event-step-finish" &&
				chunk.payload.result
			) {
				responseText = chunk.payload.result;
			}
		}

		logger.debug("Network generation complete", {
			responseLength: responseText.length,
		});

		return {
			shouldContinue: true,
			classification: inputData.classification,
			rawResponse: responseText,
			originalInput: inputData.originalInput,
		};
	},
});

/**
 * Step 3: Stylize response based on guild owner's persona
 */
const stylizeStep = createStep({
	id: "stylize",
	inputSchema: z.object({
		shouldContinue: z.boolean(),
		classification: z
			.object({
				shouldRespond: z.boolean(),
				reasoning: z.string(),
				confidence: z.number(),
			})
			.optional(),
		rawResponse: z.string(),
		originalInput: workflowInputSchema,
	}),
	outputSchema: workflowOutputSchema,
	execute: async ({ inputData }) => {
		// If not continuing, return early
		if (!inputData.shouldContinue || !inputData.rawResponse) {
			return {
				shouldRespond: false,
				response: "",
				classification: inputData.classification,
				rawResponse: inputData.rawResponse,
				persona: undefined,
			};
		}

		const { originalInput, rawResponse } = inputData;

		// Get the persona for this guild
		const persona = await getGuildPersona(originalInput.guildId);

		logger.debug("Stylizing response", {
			guildId: originalInput.guildId,
			persona,
			rawResponseLength: rawResponse.length,
		});

		// Build style context
		const styleContext = buildStyleContext(persona);

		// If no style context available, return raw response
		if (!styleContext || styleContext.exampleMessages.length === 0) {
			logger.debug("No style context available, returning raw response");
			return {
				shouldRespond: true,
				response: rawResponse,
				classification: inputData.classification,
				rawResponse,
				persona,
			};
		}

		// Build the stylization prompt
		const stylizationPrompt = formatStylizationPrompt(
			styleContext,
			rawResponse,
		);

		// Use the stylization agent
		const result = await stylizationAgent.generate(stylizationPrompt);

		logger.debug("Stylization complete", {
			persona,
			originalLength: rawResponse.length,
			styledLength: result.text.length,
		});

		return {
			shouldRespond: true,
			response: result.text,
			classification: inputData.classification,
			rawResponse,
			persona,
		};
	},
});

/**
 * Format the prompt for stylization
 */
function formatStylizationPrompt(
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
	const exampleList = exampleMessages
		.map((m) => `- "${m.content}"`)
		.join("\n");

	return `Rewrite the following message to match this person's writing style. Keep the EXACT same meaning and content, but change the tone, vocabulary, and sentence structure.

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

/**
 * The main response workflow.
 *
 * Flow:
 * 1. (Optional) Classify - Determines if the bot should respond
 * 2. Generate - Routes through the Agent Network to generate a response
 * 3. Stylize - Applies the guild owner's persona style to the response
 */
export const responseWorkflow = createWorkflow({
	id: "birmel-response",
	inputSchema: workflowInputSchema,
	outputSchema: workflowOutputSchema,
})
	.then(classifyStep)
	.then(generateStep)
	.then(stylizeStep)
	.commit();

export type ResponseWorkflowInput = z.infer<typeof workflowInputSchema>;
export type ResponseWorkflowOutput = z.infer<typeof workflowOutputSchema>;
