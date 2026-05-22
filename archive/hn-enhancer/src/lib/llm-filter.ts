import { z } from "zod/v4";
import { debug } from "#src/lib/debug.ts";
import { getLLMCacheEntry, setLLMCacheEntry } from "#src/lib/storage.ts";

export type LLMClassification = {
  negative: boolean;
  confidence: number;
};

const LLMResponseSchema = z.object({
  negative: z.boolean(),
  confidence: z.number(),
});

const SYSTEM_PROMPT = `You identify Hacker News comments that are unwilling to engage honestly about AI/LLMs — bad-faith, discussion-killing comments rather than legitimate criticism.
Reply ONLY with JSON: {"negative": true/false, "confidence": 0.0-1.0}

FILTER (bad faith / discussion-killing):
- Thought-terminating cliches that shut down discussion ("stochastic parrot", "spicy autocomplete", "just a wrapper")
- Bad-faith dismissals with no engagement with the actual point being made
- Ad hominem / tribal signaling ("AI bros", "cultists", "drinking the kool-aid")
- Sarcastic contempt without substance
- Reductive labels used to avoid engaging ("glorified autocomplete", "blurry jpeg")
- Moving goalposts — dismissing evidence without engaging with it
- "AI slop", "snake oil", "grift" used as thought-terminators
- Categorical absolute claims ("will never understand", "can't reason") without reasoning

ALLOW (genuine engagement — even if critical or skeptical):
- Genuine concerns about AI (job displacement, energy use, accuracy, bias)
- Specific technical criticisms backed by reasoning or experience
- Disagreement backed by evidence ("I tried X and found Y")
- Skepticism with substance ("The benchmarks don't reflect real usage because...")
- Expressing preference for manual work without contempt for others
- Balanced takes: "useful for X, limited at Y"
- Discussing hallucination mitigation, limitations constructively
- Factual descriptions of how models work`;

let session: LanguageModelSession | undefined;

async function createSession(): Promise<LanguageModelSession | undefined> {
  if (typeof LanguageModel === "undefined") return undefined;

  return LanguageModel.create({
    expectedOutputLanguages: ["en"],
    initialPrompts: [{ role: "system", content: SYSTEM_PROMPT }],
  });
}

export function isLLMAvailable(): boolean {
  return typeof LanguageModel !== "undefined";
}

async function getSession(): Promise<LanguageModelSession | undefined> {
  session ??= await createSession();
  return session;
}

async function hashText(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = [...new Uint8Array(hashBuffer)];
  return hashArray
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function classifyWithLLM(
  text: string,
): Promise<LLMClassification | undefined> {
  const hash = await hashText(text);

  // Check cache first
  const cached = await getLLMCacheEntry(hash);
  if (cached) {
    debug("llm", {
      hash,
      cacheHit: true,
      negative: cached.negative,
      confidence: cached.confidence,
    });
    return { negative: cached.negative, confidence: cached.confidence };
  }

  // Try LLM
  const s = await getSession();
  if (!s) return undefined;

  const response = await s.prompt(
    `Classify this HN comment:\n\n${text.slice(0, 1000)}`,
  );

  debug("llm", { hash, cacheHit: false, rawResponse: response.slice(0, 200) });

  const parsed = parseResponse(response);
  if (!parsed) return undefined;

  // Cache the result
  await setLLMCacheEntry(hash, {
    negative: parsed.negative,
    confidence: parsed.confidence,
    timestamp: Date.now(),
  });

  return parsed;
}

function parseResponse(response: string): LLMClassification | undefined {
  const jsonMatch = /\{[^}]+\}/.exec(response);
  if (jsonMatch === null) return undefined;

  const raw: unknown = JSON.parse(jsonMatch[0]);
  const result = LLMResponseSchema.safeParse(raw);
  if (result.success) return result.data;
  return undefined;
}

export async function classifyBatchProgressive(
  texts: { id: string; text: string }[],
  onResult: (id: string, result: LLMClassification | undefined) => void,
  concurrency = 3,
): Promise<void> {
  for (let i = 0; i < texts.length; i += concurrency) {
    const batch = texts.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async ({ id, text }) => {
        const result = await classifyWithLLM(text);
        return [id, result] as const;
      }),
    );

    for (const [id, result] of batchResults) {
      onResult(id, result);
    }

    // Yield to the main thread between batches
    if (i + concurrency < texts.length) {
      await new Promise<void>((resolve) => {
        if ("requestIdleCallback" in globalThis) {
          requestIdleCallback(() => {
            resolve();
          });
        } else {
          setTimeout(resolve, 10);
        }
      });
    }
  }
}
