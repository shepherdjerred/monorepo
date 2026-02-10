import Anthropic from "@anthropic-ai/sdk";
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

/** Claude API client with rate limiting and retry */
export class ClaudeClient {
  private readonly client: Anthropic;
  private readonly config: DeminifyConfig;
  private readonly bucket: TokenBucket;
  private requestCount = 0;
  private inputTokensUsed = 0;
  private outputTokensUsed = 0;

  constructor(config: DeminifyConfig) {
    this.config = config;
    this.client = new Anthropic({
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

  /** Call Claude API with retry logic */
  private async callWithRetry(
    systemPrompt: string,
    userPrompt: string,
    context: DeminifyContext,
    maxRetries = 3,
  ): Promise<DeminifyResult> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await this.client.messages.create({
          model: this.config.model,
          max_tokens: this.config.maxTokens,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        });

        // Track token usage
        this.inputTokensUsed += response.usage.input_tokens;
        this.outputTokensUsed += response.usage.output_tokens;

        // Parse response
        const content = response.content[0];
        if (content?.type !== "text") {
          throw new Error("Unexpected response type");
        }

        return this.parseResponse(content.text, context);
      } catch (error) {
        lastError = error as Error;

        // Check for rate limit error
        if (error instanceof Anthropic.APIError && error.status === 429) {
          const retryAfter = 60; // Default to 60 seconds for rate limiting
          if (this.config.verbose) {
            console.error(
              `Rate limited, waiting ${String(retryAfter)}s before retry...`,
            );
          }
          await this.sleep(retryAfter * 1000);
          continue;
        }

        // Check for overload error
        if (error instanceof Anthropic.APIError && error.status === 529) {
          const backoff = Math.pow(2, attempt) * 1000;
          if (this.config.verbose) {
            console.error(`API overloaded, waiting ${String(backoff)}ms before retry...`);
          }
          await this.sleep(backoff);
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

  /** Parse Claude's response into structured result */
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

    // Pricing for Claude Haiku 4.5 (as of 2025)
    // Input: $1 per million tokens
    // Output: $5 per million tokens
    const inputCost = (totalInputTokens / 1_000_000) * 1;
    const outputCost = (totalOutputTokens / 1_000_000) * 5;

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

  /** Get usage statistics */
  getStats(): { requestCount: number; inputTokensUsed: number; outputTokensUsed: number } {
    return {
      requestCount: this.requestCount,
      inputTokensUsed: this.inputTokensUsed,
      outputTokensUsed: this.outputTokensUsed,
    };
  }
}

/** Format cost estimate for display */
export function formatCostEstimate(estimate: CostEstimate): string {
  const lines: string[] = [];
  lines.push(`Functions to process: ${String(estimate.functionCount)}`);
  lines.push(`Estimated API requests: ${String(estimate.requestCount)}`);
  lines.push(`Estimated input tokens: ${estimate.inputTokens.toLocaleString()}`);
  lines.push(`Estimated output tokens: ${estimate.outputTokens.toLocaleString()}`);
  lines.push(`Estimated cost: $${estimate.estimatedCost.toFixed(2)}`);
  return lines.join("\n");
}
