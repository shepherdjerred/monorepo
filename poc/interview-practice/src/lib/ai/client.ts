import { z } from "zod/v4";
import type { AiProvider } from "#config";
import { createOpenAIClient } from "./openai.ts";
import { createGoogleClient } from "./google.ts";

export type Message = {
  role: "user" | "assistant" | "system";
  content: string;
}

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type ToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type AIResponse = {
  text: string;
  toolCalls: ToolCall[];
  tokensIn: number;
  tokensOut: number;
  stopReason: string;
}

export type AIClient = {
  chat: (options: {
    systemPrompt: string;
    messages: Message[];
    tools?: ToolDefinition[] | undefined;
    maxTokens?: number | undefined;
  }) => Promise<AIResponse>;
}

export function createAIClient(
  provider: AiProvider,
  model: string,
  apiKey?: string  ,
): AIClient {
  switch (provider) {
    case "anthropic":
      return createAnthropicClient(model, apiKey);
    case "openai":
      return createOpenAIClient(model, apiKey);
    case "google":
      return createGoogleClient(model, apiKey);
  }
}

function createAnthropicClient(
  model: string,
  apiKey: string | undefined,
): AIClient {
  let cachedClient: InstanceType<typeof import("@anthropic-ai/sdk").default> | null = null;

  async function getClient() {
    if (cachedClient !== null) return cachedClient;
    const sdk = await import("@anthropic-ai/sdk");
    const Anthropic = sdk.default;
    cachedClient = new Anthropic({ apiKey });
    return cachedClient;
  }

  return {
    async chat(options) {
      const client = await getClient();

      const tools =
        options.tools && options.tools.length > 0
          ? options.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: {
                type: "object" as const,
                ...t.inputSchema,
              },
            }))
          : undefined;

      const messages = options.messages.map((m) => ({
        role: (m.role === "system" ? "user" : m.role),
        content:
          m.role === "system" ? `[System context] ${m.content}` : m.content,
      }));

      const response = await client.messages.create({
        model,
        max_tokens: options.maxTokens ?? 4096,
        system: options.systemPrompt,
        messages,
        ...(tools ? { tools } : {}),
      });

      const textBlocks = response.content.filter(
        (b) => b.type === "text",
      );
      const toolBlocks = response.content.filter(
        (b) => b.type === "tool_use",
      );

      return {
        text: textBlocks
          .map((b) => b.text)
          .join(""),
        toolCalls: toolBlocks.map((b) => ({
          id: b.id,
          name: b.name,
          input: z.record(z.string(), z.unknown()).parse(b.input),
        })),
        tokensIn: response.usage.input_tokens,
        tokensOut: response.usage.output_tokens,
        stopReason: response.stop_reason ?? "end_turn",
      };
    },
  };
}
