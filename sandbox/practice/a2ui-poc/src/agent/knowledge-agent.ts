import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { getConfig } from "../config/index.js";
import { KNOWLEDGE_AGENT_SYSTEM_PROMPT } from "./system-prompt.js";
import type { A2UIMessage, UserAction } from "../a2ui/types.js";
import { logger } from "../utils/logger.js";

export class KnowledgeAgent {
  private anthropic;

  constructor() {
    const config = getConfig();
    this.anthropic = createAnthropic({
      apiKey: config.anthropic.apiKey,
    });
  }

  async *exploreTopic(query: string): AsyncGenerator<A2UIMessage> {
    logger.info("Exploring topic with AI-generated UI", { query });

    try {
      const config = getConfig();

      // Call AI to generate A2UI components directly
      const result = await generateText({
        model: this.anthropic(config.anthropic.model),
        system: KNOWLEDGE_AGENT_SYSTEM_PROMPT,
        prompt: `Generate an interactive UI for exploring: ${query}`,
        maxTokens: 8000,
      });

      logger.debug("AI response received", { length: result.text.length });

      // Strip markdown code blocks if present (safety measure)
      let cleanText = result.text;
      cleanText = cleanText.replace(/```json\n?/g, "");
      cleanText = cleanText.replace(/```\n?/g, "");

      // Parse newline-delimited JSON messages
      const lines = cleanText.split("\n").filter((line) => line.trim());

      for (const line of lines) {
        try {
          const message = JSON.parse(line) as A2UIMessage;
          yield message;
        } catch (parseError) {
          logger.warn("Failed to parse A2UI message", {
            line,
            error: parseError,
          });
        }
      }
    } catch (error) {
      logger.error("Failed to generate AI UI", error);
      // Fallback: generate a simple error message
      yield {
        surfaceUpdate: {
          surfaceId: "error-surface",
          components: [
            {
              id: "root",
              component: {
                Column: {
                  children: { explicitList: ["error-text"] },
                  alignment: "center",
                },
              },
            },
            {
              id: "error-text",
              component: {
                Text: {
                  text: {
                    literalString: `Failed to generate UI for "${query}". Please try again.`,
                  },
                  usageHint: "body",
                },
              },
            },
          ],
        },
      };
      yield {
        beginRendering: {
          surfaceId: "error-surface",
          root: "root",
        },
      };
    }
  }

  async *handleUserAction(
    action: UserAction["userAction"],
  ): AsyncGenerator<A2UIMessage> {
    logger.info("Handling user action with AI-generated UI", {
      name: action.name,
      context: action.context,
    });

    try {
      const config = getConfig();

      // Build context description for the AI
      const contextStr = Object.entries(action.context)
        .map(([key, value]) => `${key}: ${value}`)
        .join(", ");

      const prompt = `User performed action: ${action.name}. Context: ${contextStr}. Generate an appropriate UI response.`;

      // Call AI to generate A2UI components for the action response
      const result = await generateText({
        model: this.anthropic(config.anthropic.model),
        system: KNOWLEDGE_AGENT_SYSTEM_PROMPT,
        prompt,
        maxTokens: 8000,
      });

      logger.debug("AI action response received", {
        length: result.text.length,
      });

      // Strip markdown code blocks if present (safety measure)
      let cleanText = result.text;
      cleanText = cleanText.replace(/```json\n?/g, "");
      cleanText = cleanText.replace(/```\n?/g, "");

      // Parse newline-delimited JSON messages
      const lines = cleanText.split("\n").filter((line) => line.trim());

      for (const line of lines) {
        try {
          const message = JSON.parse(line) as A2UIMessage;
          yield message;
        } catch (parseError) {
          logger.warn("Failed to parse A2UI message", {
            line,
            error: parseError,
          });
        }
      }
    } catch (error) {
      logger.error("Failed to generate AI action response", error);
      // Fallback error
      yield {
        surfaceUpdate: {
          surfaceId: "error-surface",
          components: [
            {
              id: "root",
              component: {
                Column: {
                  children: { explicitList: ["error-text"] },
                  alignment: "center",
                },
              },
            },
            {
              id: "error-text",
              component: {
                Text: {
                  text: {
                    literalString:
                      "Failed to process action. Please try again.",
                  },
                  usageHint: "body",
                },
              },
            },
          ],
        },
      };
      yield {
        beginRendering: {
          surfaceId: "error-surface",
          root: "root",
        },
      };
    }
  }
}
