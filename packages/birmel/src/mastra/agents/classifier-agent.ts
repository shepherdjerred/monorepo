import { Agent } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";
import { getConfig } from "../../config/index.js";

const CLASSIFIER_PROMPT = `You are a classifier that determines if a Discord bot named Birmel should respond to a message.

You will receive the last 5-10 messages from a Discord channel, followed by the new message to classify.

Respond with JSON only:
{
  "shouldRespond": boolean,
  "reasoning": "brief explanation",
  "confidence": 0.0-1.0
}

RULES FOR WHEN TO RESPOND (shouldRespond: true):
1. The message is directed at "Birmel" or the bot
2. Someone asks a question the bot could reasonably answer
3. The bot was part of a recent exchange and a follow-up is expected
4. Someone is asking for help with server management
5. The message explicitly requests the bot's attention

RULES FOR WHEN NOT TO RESPOND (shouldRespond: false):
1. Private conversation between users not involving the bot
2. Off-topic casual chat unrelated to the bot
3. The bot already responded and no new question was asked
4. Someone is just chatting with other users
5. The message is a reaction or short acknowledgment
6. The user is explaining the bot's behavior to another user (meta-discussion ABOUT the bot, not a request TO it)
   - e.g., "yeah I need to add you to the whitelist" → explaining to another human
   - e.g., "it doesn't respond to everyone" → talking about the bot in third person
7. The message contains "you" or "your" directed at another human who recently spoke
   - Look at conversation flow: if another user just asked something and "you" makes sense as addressing them, don't respond

Be conservative - when in doubt, don't respond (shouldRespond: false, lower confidence).

Examples:
- "hey can someone help me with roles" -> true (asking for help)
- "lol yeah that was funny" -> false (casual chat)
- "what time is it" -> maybe true if recent context suggests asking bot
- "@Birmel" or "birmel can you..." -> always true (explicit mention)`;

export function createClassifierAgent(): Agent {
  const config = getConfig();

  return new Agent({
    id: "birmel-classifier",
    name: "BirmelClassifier",
    instructions: CLASSIFIER_PROMPT,
    // Use Chat Completions API to avoid Responses API issues
    model: openai.chat(config.openai.classifierModel),
  });
}

export type ClassificationResult = {
  shouldRespond: boolean;
  reasoning: string;
  confidence: number;
};

export function parseClassificationResult(text: string): ClassificationResult {
  try {
    // Try to extract JSON from the response
    const jsonMatch = /\{[\s\S]*\}/.exec(text);
    if (!jsonMatch) {
      throw new Error("No JSON found in response");
    }

    const json = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const reasoning = json["reasoning"];
    return {
      shouldRespond: Boolean(json["shouldRespond"]),
      reasoning: typeof reasoning === "string" ? reasoning : "Unknown",
      confidence: Number(json["confidence"] ?? 0.5),
    };
  } catch {
    // Default to not responding on parse failure
    return {
      shouldRespond: false,
      reasoning: "Failed to parse classification response",
      confidence: 0,
    };
  }
}
