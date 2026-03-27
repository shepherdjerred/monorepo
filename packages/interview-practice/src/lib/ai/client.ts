import type { AiProvider } from "#config";

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
      throw new Error("OpenAI text client not yet implemented (Phase 2)");
    case "google":
      throw new Error("Google text client not yet implemented (Phase 2)");
  }
}

function createAnthropicClient(
  model: string,
  apiKey: string | undefined,
): AIClient {
  return {
    async chat(options) {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const client = new Anthropic({ apiKey });

      const tools =
        options.tools && options.tools.length > 0
          ? options.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.inputSchema as {
                type: "object";
                properties?: Record<string, unknown>;
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
          .map((b) => (b.type === "text" ? b.text : ""))
          .join(""),
        toolCalls: toolBlocks.map((b) => {
          if (b.type !== "tool_use") throw new Error("Unexpected block type");
          return {
            id: b.id,
            name: b.name,
            input: b.input as Record<string, unknown>,
          };
        }),
        tokensIn: response.usage.input_tokens,
        tokensOut: response.usage.output_tokens,
        stopReason: response.stop_reason ?? "end_turn",
      };
    },
  };
}
