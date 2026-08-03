import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { createOpenAIClient } from "#materialization/openai-client.ts";

const RequestBodySchema = z.object({
  max_completion_tokens: z.number(),
  messages: z.array(z.object({ content: z.string(), role: z.string() })),
  model: z.string(),
});

describe("createOpenAIClient", () => {
  test("sends server-side credentials and validates the response", async () => {
    let authorization: string | null = null;
    let requestBody: unknown;
    const client = createOpenAIClient("secret-key", async (_input, init) => {
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
              message: { content: "A specific review", refusal: null },
            },
          ],
          id: "ignored-external-field",
          usage: { completion_tokens: 7, prompt_tokens: 19 },
        },
        { status: 200 },
      );
    });

    const result = await client.chat.completions.create({
      max_completion_tokens: 3000,
      messages: [
        { content: "System", role: "system" },
        { content: "User", role: "user" },
      ],
      model: "gpt-test",
    });

    expect(z.string().parse(authorization)).toBe("Bearer secret-key");
    expect(RequestBodySchema.parse(requestBody)).toEqual({
      max_completion_tokens: 3000,
      messages: [
        { content: "System", role: "system" },
        { content: "User", role: "user" },
      ],
      model: "gpt-test",
    });
    expect(result).toEqual({
      choices: [
        {
          finish_reason: "stop",
          message: { content: "A specific review", refusal: null },
        },
      ],
      usage: { completion_tokens: 7, prompt_tokens: 19 },
    });
  });

  test("fails loudly on provider errors", async () => {
    const client = createOpenAIClient(
      "secret-key",
      async () => new Response("rate limited", { status: 429 }),
    );

    await expect(
      client.chat.completions.create({
        max_completion_tokens: 10,
        messages: [{ content: "User", role: "user" }],
        model: "gpt-test",
      }),
    ).rejects.toThrow("OpenAI returned 429: rate limited");
  });
});
