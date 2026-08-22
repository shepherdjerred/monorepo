import { describe, expect, test } from "vitest";
import { z } from "zod";

import { createOpenRouterClient } from "#materialization/openrouter-client.ts";

const RequestBodySchema = z.looseObject({
  max_tokens: z.number(),
  messages: z.array(z.object({ content: z.unknown(), role: z.string() })),
  model: z.string(),
  provider: z.object({
    allow_fallbacks: z.boolean(),
    data_collection: z.literal("deny"),
  }),
  usage: z.object({ include: z.literal(true) }),
});

describe("createOpenRouterClient", () => {
  test("sends gateway credentials, policy, and a stable catalog route", async () => {
    let authorization: string | null = null;
    let requestBody: unknown;
    const client = createOpenRouterClient(
      "secret-key",
      async (_input, init) => {
        authorization = new Headers(init?.headers).get("authorization");
        if (typeof init?.body !== "string") {
          throw new TypeError("Expected a JSON request body");
        }
        requestBody = JSON.parse(init.body);
        return Response.json(
          {
            choices: [
              {
                finish_reason: "stop",
                index: 0,
                message: {
                  content: "A specific review",
                  role: "assistant",
                },
              },
            ],
            created: 1,
            id: "generation-1",
            model: "openai/gpt-5.4-nano",
            usage: {
              completion_tokens: 7,
              prompt_tokens: 19,
              total_tokens: 26,
            },
          },
          { status: 200 },
        );
      },
    );

    const result = await client.generate({
      maxOutputTokens: 3000,
      model: "gpt-5.4-nano",
      systemPrompt: "System",
      userPrompt: "User",
      workload: "scout.eval.test",
    });

    expect(z.string().parse(authorization)).toBe("Bearer secret-key");
    const parsedRequest = RequestBodySchema.parse(requestBody);
    expect(parsedRequest).toMatchObject({
      max_tokens: 3000,
      model: "openai/gpt-5.4-nano",
      provider: { allow_fallbacks: true, data_collection: "deny" },
      usage: { include: true },
    });
    expect(parsedRequest.messages.map(({ role }) => role)).toEqual([
      "system",
      "user",
    ]);
    expect(JSON.stringify(parsedRequest.messages)).toContain("System");
    expect(JSON.stringify(parsedRequest.messages)).toContain("User");
    expect(result).toMatchObject({
      finishReason: "stop",
      inputTokens: 19,
      outputTokens: 7,
      text: "A specific review",
      openRouter: {
        generationId: "generation-1",
        requestedModel: "gpt-5.4-nano",
        resolvedModel: "openai/gpt-5.4-nano",
        fallbackAttempts: 0,
        routerMetadataPresent: false,
      },
    });
  });

  test("fails loudly on gateway authentication errors", async () => {
    const client = createOpenRouterClient("secret-key", async () =>
      Response.json(
        { error: { code: 401, message: "invalid OpenRouter key" } },
        { status: 401 },
      ),
    );

    await expect(
      client.generate({
        maxOutputTokens: 10,
        model: "gpt-5.4-nano",
        userPrompt: "User",
        workload: "scout.eval.test",
      }),
    ).rejects.toThrow("invalid OpenRouter key");
  });
});
