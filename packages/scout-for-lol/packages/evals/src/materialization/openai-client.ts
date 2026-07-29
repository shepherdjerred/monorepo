import type { OpenAIClient } from "@scout-for-lol/data";
import { z } from "zod";

const OpenAIResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({
          content: z.string().nullable(),
          refusal: z.string().nullable().optional(),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
    })
    .optional(),
});

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function createOpenAIClient(
  apiKey: string,
  fetcher: Fetcher = fetch,
): OpenAIClient {
  if (apiKey.trim() === "") throw new Error("OPENAI_API_KEY must not be empty");
  return {
    chat: {
      completions: {
        create: async (params) => {
          const response = await fetcher(
            "https://api.openai.com/v1/chat/completions",
            {
              body: JSON.stringify(params),
              headers: {
                authorization: `Bearer ${apiKey}`,
                "content-type": "application/json",
              },
              method: "POST",
              signal: AbortSignal.timeout(120_000),
            },
          );
          if (!response.ok) {
            throw new Error(
              `OpenAI returned ${response.status.toString()}: ${await response.text()}`,
            );
          }
          const payload: unknown = await response.json();
          const parsed = OpenAIResponseSchema.parse(payload);
          const choices = parsed.choices.map((choice) => ({
            finish_reason: choice.finish_reason ?? null,
            message: {
              content: choice.message.content,
              refusal: choice.message.refusal ?? null,
            },
          }));
          if (parsed.usage === undefined) return { choices };
          return { choices, usage: parsed.usage };
        },
      },
    },
  };
}
