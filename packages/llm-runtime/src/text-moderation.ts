import { z } from "zod";
import type { ProviderCredentials } from "./types.ts";

const ScoresSchema = z.record(z.string(), z.number().min(0).max(1));
const ResponseSchema = z.object({
  model: z.string().min(1),
  results: z.array(z.object({ category_scores: ScoresSchema })).length(1),
});

type ModerationFetch = (url: string, init: RequestInit) => Promise<Response>;

/** Safe diagnostics only: callers may report the message without private provider bodies. */
export class TextModerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TextModerationError";
  }
}

/** Dedicated free classifier transport. Never log input or provider response bodies. */
export function createTextModeration(options: {
  credentials: ProviderCredentials;
  fetcher?: ModerationFetch;
}) {
  const apiKey = options.credentials.openai?.apiKey;
  if (apiKey === undefined || apiKey.trim() === "")
    throw new TextModerationError("Moderation requires OpenAI credentials");
  const fetcher = options.fetcher ?? fetch;
  return async (
    text: string,
  ): Promise<{
    model: string;
    scores: Record<string, number>;
  }> => {
    let response: Response;
    try {
      response = await fetcher("https://api.openai.com/v1/moderations", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: "omni-moderation-latest", input: text }),
        signal: AbortSignal.timeout(2500),
      });
    } catch {
      throw new TextModerationError("Moderation transport failed");
    }
    if (!response.ok)
      throw new TextModerationError(
        `Moderation returned HTTP ${String(response.status)}`,
      );
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new TextModerationError("Moderation returned invalid JSON");
    }
    const result = ResponseSchema.safeParse(raw);
    if (!result.success)
      throw new TextModerationError("Moderation returned invalid scores");
    const scores = result.data.results[0]?.category_scores;
    if (scores === undefined)
      throw new TextModerationError("Moderation result missing");
    for (const category of [
      "hate",
      "hate/threatening",
      "harassment",
      "harassment/threatening",
    ])
      if (scores[category] === undefined)
        throw new TextModerationError("Moderation category missing");
    return { model: result.data.model, scores };
  };
}
