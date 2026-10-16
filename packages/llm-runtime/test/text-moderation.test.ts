import { describe, expect, test, vi } from "vitest";
import { createTextModeration, TextModerationError } from "#src/index.ts";

const credentials = { openai: { apiKey: "fixture-key" } };
const scores = {
  hate: 0,
  "hate/threatening": 0,
  harassment: 0.6,
  "harassment/threatening": 0,
};
const result = {
  model: "moderation-fixture",
  results: [{ category_scores: scores }],
};

describe("dedicated text moderation transport", () => {
  test("sends the dedicated model and returns validated scores without logging bodies", async () => {
    const fetcher = vi.fn(async () => Response.json(result));
    const classify = createTextModeration({ credentials, fetcher });
    expect(await classify("private test content")).toEqual({
      model: result.model,
      scores,
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.openai.com/v1/moderations",
      {
        method: "POST",
        headers: {
          authorization: "Bearer fixture-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "omni-moderation-latest",
          input: "private test content",
        }),
        signal: expect.any(AbortSignal),
      },
    );
  });

  test("requires explicitly configured OpenAI credentials", () => {
    expect(() => createTextModeration({ credentials: {} })).toThrow(
      TextModerationError,
    );
    expect(() =>
      createTextModeration({ credentials: { openai: { apiKey: " " } } }),
    ).toThrow(TextModerationError);
  });

  test.each([401, 403, 429, 503])(
    "preserves HTTP %s without disclosing the body",
    async (status) => {
      const classify = createTextModeration({
        credentials,
        fetcher: async () =>
          new Response("private provider details", { status }),
      });
      await expect(classify("private test content")).rejects.toThrow(
        `Moderation returned HTTP ${status.toString()}`,
      );
    },
  );

  test("transport failures do not expose exception details", async () => {
    const classify = createTextModeration({
      credentials,
      fetcher: async () => {
        throw new Error("private provider details");
      },
    });
    await expect(classify("private test content")).rejects.toThrow(
      "Moderation transport failed",
    );
  });

  test("rejects malformed JSON without disclosing provider details", async () => {
    const classify = createTextModeration({
      credentials,
      fetcher: async () => new Response("private invalid JSON"),
    });
    await expect(classify("private test content")).rejects.toThrow(
      "Moderation returned invalid JSON",
    );
  });

  test.each([
    { model: "fixture", results: [] },
    {
      model: "fixture",
      results: [{ category_scores: { hate: "private details" } }],
    },
    {
      model: "fixture",
      results: [{ category_scores: { ...scores, hate: 1.1 } }],
    },
  ])("rejects invalid response scores", async (body) => {
    const classify = createTextModeration({
      credentials,
      fetcher: async () => Response.json(body),
    });
    await expect(classify("private test content")).rejects.toThrow(
      "Moderation returned invalid scores",
    );
  });

  test("requires the categories used by content policies", async () => {
    const classify = createTextModeration({
      credentials,
      fetcher: async () =>
        Response.json({ model: "fixture", results: [{ category_scores: {} }] }),
    });
    await expect(classify("private test content")).rejects.toThrow(
      "Moderation category missing",
    );
  });
});
