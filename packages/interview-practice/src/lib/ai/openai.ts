import { z } from "zod/v4";
import type { AIClient } from "./client.ts";

const FunctionToolCallSchema = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
});

export function createOpenAIClient(
  model: string,
  apiKey: string | undefined,
): AIClient {
  return {
    async chat(options) {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({ apiKey });

      const tools =
        options.tools && options.tools.length > 0
          ? options.tools.map((t) => ({
              type: "function" as const,
              function: {
                name: t.name,
                description: t.description,
                parameters: {
                  type: "object" as const,
                  ...t.inputSchema,
                },
              },
            }))
          : undefined;

      const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
        { role: "system", content: options.systemPrompt },
        ...options.messages.map((m) => ({
          role: (m.role === "system" ? "user" as const : m.role),
          content:
            m.role === "system"
              ? `[System context] ${m.content}`
              : m.content,
        })),
      ];

      const response = await client.chat.completions.create({
        model,
        max_completion_tokens: options.maxTokens ?? 4096,
        messages,
        ...(tools === undefined ? {} : { tools }),
      });

      const choice = response.choices[0];
      if (choice === undefined) {
        return {
          text: "",
          toolCalls: [],
          tokensIn: response.usage?.prompt_tokens ?? 0,
          tokensOut: response.usage?.completion_tokens ?? 0,
          stopReason: "error",
        };
      }

      const text = choice.message.content ?? "";
      const rawToolCalls = choice.message.tool_calls ?? [];

      const toolCalls = rawToolCalls
        .filter((tc) => tc.type === "function")
        .map((tc) => {
          const validated = FunctionToolCallSchema.parse(tc);
          const parsed = JSON.parse(validated.function.arguments) as unknown;
          return {
            id: validated.id,
            name: validated.function.name,
            input: z.record(z.string(), z.unknown()).parse(parsed),
          };
        });

      return {
        text,
        toolCalls,
        tokensIn: response.usage?.prompt_tokens ?? 0,
        tokensOut: response.usage?.completion_tokens ?? 0,
        stopReason: choice.finish_reason,
      };
    },
  };
}
