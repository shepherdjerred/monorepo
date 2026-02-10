import OpenAI from "openai";
import { validateSource } from "./ast-parser.ts";
import {
  estimateOutputTokens,
  estimatePromptTokens,
  getFunctionPrompt,
  getSimpleFunctionPrompt,
  getSystemPrompt,
} from "./prompt-templates.ts";
import type {
  CostEstimate,
  DeminifyConfig,
  DeminifyContext,
  DeminifyResult,
  ExtractedFunction,
} from "./types.ts";

/** Token bucket for rate limiting */
type TokenBucket = {
  tokens: number;
  lastRefill: number;
  maxTokens: number;
  refillRate: number; // tokens per second
}

/** OpenAI API client with rate limiting and retry */
export class OpenAIClient {
  private readonly client: OpenAI;
  private readonly config: DeminifyConfig;
  private readonly bucket: TokenBucket;
  private requestCount = 0;
  private inputTokensUsed = 0;
  private outputTokensUsed = 0;

  constructor(config: DeminifyConfig) {
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.apiKey,
    });

    // Initialize token bucket for rate limiting
    this.bucket = {
      tokens: config.rateLimit,
      lastRefill: Date.now(),
      maxTokens: config.rateLimit,
      refillRate: config.rateLimit / 60, // Convert per-minute to per-second
    };
  }

  /** De-minify a single function */
  async deminifyFunction(context: DeminifyContext): Promise<DeminifyResult> {
    await this.waitForToken();

    const systemPrompt = getSystemPrompt();
    const userPrompt =
      context.targetFunction.source.length < 200 && context.callers.length === 0
        ? getSimpleFunctionPrompt(context.targetFunction.source)
        : getFunctionPrompt(context);

    const result = await this.callWithRetry(systemPrompt, userPrompt, context);
    this.requestCount++;

    return result;
  }

  /** Call OpenAI API with retry logic */
  private async callWithRetry(
    systemPrompt: string,
    userPrompt: string,
    context: DeminifyContext,
    maxRetries = 3,
  ): Promise<DeminifyResult> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model: this.config.model,
          max_completion_tokens: this.config.maxTokens,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        });

        // Track token usage
        if (response.usage) {
          this.inputTokensUsed += response.usage.prompt_tokens;
          this.outputTokensUsed += response.usage.completion_tokens;
        }

        // Parse response
        const content = response.choices[0]?.message.content;
        if (!content) {
          throw new Error("Empty response from OpenAI");
        }

        return this.parseResponse(content, context);
      } catch (error) {
        lastError = error as Error;

        // Check for rate limit error
        if (error instanceof OpenAI.APIError && error.status === 429) {
          const retryAfter = 60; // Default to 60 seconds for rate limiting
          if (this.config.verbose) {
            console.error(
              `Rate limited, waiting ${String(retryAfter)}s before retry...`,
            );
          }
          await this.sleep(retryAfter * 1000);
          continue;
        }

        // For other errors, use exponential backoff
        if (attempt < maxRetries - 1) {
          const backoff = Math.pow(2, attempt) * 1000;
          await this.sleep(backoff);
        }
      }
    }

    throw lastError ?? new Error("Max retries exceeded");
  }

  /** Parse OpenAI's response into structured result */
  private parseResponse(
    responseText: string,
    context: DeminifyContext,
  ): DeminifyResult {
    // Extract code from markdown code blocks
    const codeMatch = /```(?:javascript|js)?\n?([\s\S]*?)```/.exec(responseText);
    if (!codeMatch?.[1]) {
      throw new Error("No code block found in response");
    }

    const deminifiedSource = codeMatch[1].trim();

    // Validate the code parses
    if (!validateSource(deminifiedSource)) {
      throw new Error("De-minified code failed to parse");
    }

    // Try to extract metadata JSON
    let suggestedName = context.targetFunction.originalName || "anonymousFunction";
    let confidence = 0.5;
    let parameterNames: Record<string, string> = {};
    let localVariableNames: Record<string, string> = {};

    // Look for JSON after the code block
    const jsonMatch = /```[\s\S]*?```\s*(\{[\s\S]*\})/.exec(responseText);
    if (jsonMatch?.[1]) {
      try {
        const metadata = JSON.parse(jsonMatch[1]) as {
          suggestedName?: string;
          confidence?: number;
          parameterNames?: Record<string, string>;
          localVariableNames?: Record<string, string>;
        };
        if (metadata.suggestedName) {suggestedName = metadata.suggestedName;}
        if (typeof metadata.confidence === "number") {confidence = metadata.confidence;}
        if (metadata.parameterNames) {parameterNames = metadata.parameterNames;}
        if (metadata.localVariableNames) {localVariableNames = metadata.localVariableNames;}
      } catch {
        // JSON parsing failed, use defaults
      }
    }

    // Try to infer name from the de-minified code if not provided
    if (suggestedName === "anonymousFunction") {
      const funcNameMatch = /(?:function|const|let|var)\s+([a-zA-Z_$][\w$]*)/.exec(deminifiedSource);
      if (funcNameMatch?.[1]) {
        suggestedName = funcNameMatch[1];
      }
    }

    return {
      functionId: context.targetFunction.id,
      originalSource: context.targetFunction.source,
      deminifiedSource,
      suggestedName,
      confidence,
      parameterNames,
      localVariableNames,
    };
  }

  /** Wait for rate limit token */
  private async waitForToken(): Promise<void> {
    this.refillBucket();

    while (this.bucket.tokens < 1) {
      await this.sleep(100);
      this.refillBucket();
    }

    this.bucket.tokens--;
  }

  /** Refill the token bucket */
  private refillBucket(): void {
    const now = Date.now();
    const elapsed = (now - this.bucket.lastRefill) / 1000;
    this.bucket.tokens = Math.min(
      this.bucket.maxTokens,
      this.bucket.tokens + elapsed * this.bucket.refillRate,
    );
    this.bucket.lastRefill = now;
  }

  /** Sleep for specified milliseconds */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Estimate cost for processing functions */
  estimateCost(functions: ExtractedFunction[]): CostEstimate {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    // System prompt tokens (once per request)
    const systemTokens = estimatePromptTokens(getSystemPrompt());

    for (const func of functions) {
      // Skip functions that are too small or too large
      if (
        func.source.length < this.config.minFunctionSize ||
        func.source.length > this.config.maxFunctionSize
      ) {
        continue;
      }

      // Estimate input tokens (function + context)
      const funcTokens = estimatePromptTokens(func.source);
      const contextTokens = 500; // Rough estimate for caller/callee context
      totalInputTokens += systemTokens + funcTokens + contextTokens;

      // Estimate output tokens
      totalOutputTokens += estimateOutputTokens(func.source);
    }

    // Pricing based on model
    const { inputCostPerMillion, outputCostPerMillion } = this.getModelPricing();
    const inputCost = (totalInputTokens / 1_000_000) * inputCostPerMillion;
    const outputCost = (totalOutputTokens / 1_000_000) * outputCostPerMillion;

    return {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      estimatedCost: inputCost + outputCost,
      functionCount: functions.filter(
        (f) =>
          f.source.length >= this.config.minFunctionSize &&
          f.source.length <= this.config.maxFunctionSize,
      ).length,
      requestCount: functions.filter(
        (f) =>
          f.source.length >= this.config.minFunctionSize &&
          f.source.length <= this.config.maxFunctionSize,
      ).length,
    };
  }

  /** Get pricing for the current model */
  private getModelPricing(): { inputCostPerMillion: number; outputCostPerMillion: number } {
    const model = this.config.model.toLowerCase();

    // GPT-5 pricing (per million tokens)
    if (model.includes("gpt-5-nano")) {
      return { inputCostPerMillion: 0.05, outputCostPerMillion: 0.4 };
    }
    if (model.includes("gpt-5-mini")) {
      return { inputCostPerMillion: 0.25, outputCostPerMillion: 2 };
    }
    if (model.includes("gpt-5")) {
      return { inputCostPerMillion: 1.25, outputCostPerMillion: 10 };
    }

    // GPT-4o pricing
    if (model.includes("gpt-4o-mini")) {
      return { inputCostPerMillion: 0.15, outputCostPerMillion: 0.6 };
    }
    if (model.includes("gpt-4o")) {
      return { inputCostPerMillion: 2.5, outputCostPerMillion: 10 };
    }

    // Default to GPT-5 Nano pricing
    return { inputCostPerMillion: 0.05, outputCostPerMillion: 0.4 };
  }

  /** Get usage statistics */
  getStats(): { requestCount: number; inputTokensUsed: number; outputTokensUsed: number } {
    return {
      requestCount: this.requestCount,
      inputTokensUsed: this.inputTokensUsed,
      outputTokensUsed: this.outputTokensUsed,
    };
  }
}
