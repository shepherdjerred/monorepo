/**
 * OpenAI Batch API client for async de-minification processing.
 *
 * Benefits:
 * - 50% cost reduction vs standard API
 * - No rate limits
 * - Process thousands of requests asynchronously
 *
 * Flow:
 * 1. Create JSONL file with requests
 * 2. Upload file to OpenAI
 * 3. Create batch job
 * 4. Poll for completion
 * 5. Download and parse results
 */

import OpenAI from "openai";
import { validateSource } from "./ast-parser.ts";
import {
  getSimpleFunctionPrompt,
  getFunctionPrompt,
  getSystemPrompt,
} from "./prompt-templates.ts";
import type {
  DeminifyConfig,
  DeminifyContext,
  DeminifyResult,
} from "./types.ts";

/** Batch processing status */
export type OpenAIBatchStatus = {
  batchId: string;
  status:
    | "validating"
    | "failed"
    | "in_progress"
    | "finalizing"
    | "completed"
    | "expired"
    | "cancelling"
    | "cancelled";
  total: number;
  completed: number;
  failed: number;
};

/** Batch processing callbacks */
export type OpenAIBatchCallbacks = {
  onStatusUpdate?: (status: OpenAIBatchStatus) => void;
  onComplete?: (results: Map<string, DeminifyResult>) => void;
  onError?: (error: Error) => void;
};

/** JSONL request format for OpenAI Batch API */
type BatchRequest = {
  custom_id: string;
  method: "POST";
  url: "/v1/chat/completions";
  body: {
    model: string;
    messages: { role: "system" | "user"; content: string }[];
    max_completion_tokens?: number;
  };
};

/** JSONL response format from OpenAI Batch API */
type BatchResponse = {
  id: string;
  custom_id: string;
  response: {
    status_code: number;
    request_id: string;
    body: {
      id: string;
      object: string;
      created: number;
      model: string;
      choices: {
        index: number;
        message: {
          role: string;
          content: string;
        };
        finish_reason: string;
      }[];
      usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
    };
  } | null;
  error: {
    code: string;
    message: string;
  } | null;
};

/** Client for batch de-minification using OpenAI's Batch API */
export class OpenAIBatchClient {
  private readonly client: OpenAI;
  private readonly config: DeminifyConfig;

  constructor(config: DeminifyConfig) {
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.apiKey,
    });
  }

  /**
   * Create a batch request for all function contexts.
   * Uploads JSONL file and creates batch job.
   */
  async createBatch(contexts: Map<string, DeminifyContext>): Promise<string> {
    const systemPrompt = getSystemPrompt();
    const requests: BatchRequest[] = [];

    for (const [funcId, context] of contexts) {
      const userPrompt =
        context.targetFunction.source.length < 200
          ? getSimpleFunctionPrompt(context.targetFunction.source)
          : getFunctionPrompt(context);

      requests.push({
        custom_id: funcId,
        method: "POST",
        url: "/v1/chat/completions",
        body: {
          model: this.config.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          max_completion_tokens: this.config.maxTokens,
        },
      });
    }

    if (this.config.verbose) {
      console.log(`Creating batch with ${String(requests.length)} requests...`);
    }

    // Create JSONL content
    const jsonlContent = requests.map((r) => JSON.stringify(r)).join("\n");
    const jsonlBuffer = Buffer.from(jsonlContent, "utf-8");

    // Upload file
    const file = await this.client.files.create({
      file: new File([jsonlBuffer], "batch_requests.jsonl", {
        type: "application/jsonl",
      }),
      purpose: "batch",
    });

    if (this.config.verbose) {
      console.log(`Uploaded file: ${file.id}`);
    }

    // Create batch
    const batch = await this.client.batches.create({
      input_file_id: file.id,
      endpoint: "/v1/chat/completions",
      completion_window: "24h",
    });

    if (this.config.verbose) {
      console.log(`Batch created: ${batch.id}`);
    }

    return batch.id;
  }

  /**
   * Poll for batch completion.
   */
  async waitForCompletion(
    batchId: string,
    callbacks?: OpenAIBatchCallbacks,
    pollIntervalMs = 30_000,
  ): Promise<void> {
    let batch = await this.client.batches.retrieve(batchId);

    while (
      batch.status === "validating" ||
      batch.status === "in_progress" ||
      batch.status === "finalizing"
    ) {
      const status: OpenAIBatchStatus = {
        batchId,
        status: batch.status,
        total: batch.request_counts?.total ?? 0,
        completed: batch.request_counts?.completed ?? 0,
        failed: batch.request_counts?.failed ?? 0,
      };

      callbacks?.onStatusUpdate?.(status);

      await this.sleep(pollIntervalMs);
      batch = await this.client.batches.retrieve(batchId);
    }

    // Final status update
    const finalStatus: OpenAIBatchStatus = {
      batchId,
      status: batch.status,
      total: batch.request_counts?.total ?? 0,
      completed: batch.request_counts?.completed ?? 0,
      failed: batch.request_counts?.failed ?? 0,
    };

    callbacks?.onStatusUpdate?.(finalStatus);

    if (batch.status === "failed" || batch.status === "expired") {
      throw new Error(
        `Batch ${batchId} ${batch.status}: ${JSON.stringify(batch.errors)}`,
      );
    }
  }

  /**
   * Retrieve and parse results from a completed batch.
   */
  async getResults(
    batchId: string,
    contexts: Map<string, DeminifyContext>,
  ): Promise<Map<string, DeminifyResult>> {
    const results = new Map<string, DeminifyResult>();

    // Get batch to find output file
    const batch = await this.client.batches.retrieve(batchId);

    if (batch.output_file_id == null || batch.output_file_id.length === 0) {
      throw new Error(`Batch ${batchId} has no output file`);
    }

    // Download output file
    const fileResponse = await this.client.files.content(batch.output_file_id);
    const fileContent = await fileResponse.text();

    // Parse JSONL response
    const lines = fileContent.trim().split("\n");

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      try {
        const entry = JSON.parse(line) as BatchResponse;
        const funcId = entry.custom_id;
        const context = contexts.get(funcId);

        if (!context) {
          if (this.config.verbose) {
            console.warn(`Unknown function ID in results: ${funcId}`);
          }
          continue;
        }

        if (entry.response?.status_code === 200) {
          try {
            const responseText =
              entry.response.body.choices[0]?.message.content;
            if (responseText != null && responseText.length > 0) {
              const result = this.parseResponse(responseText, context);
              results.set(funcId, result);
            }
          } catch (error) {
            if (this.config.verbose) {
              console.error(
                `Failed to parse result for ${funcId}: ${
                  (error as Error).message
                }`,
              );
            }
          }
        } else if (entry.error && this.config.verbose) {
          console.error(
            `Batch error for ${funcId}: ${entry.error.code} - ${entry.error.message}`,
          );
        }
      } catch (error) {
        if (this.config.verbose) {
          console.error(
            `Failed to parse batch response line: ${(error as Error).message}`,
          );
        }
      }
    }

    return results;
  }

  /**
   * Get the status of a batch.
   */
  async getBatchStatus(batchId: string): Promise<OpenAIBatchStatus> {
    const batch = await this.client.batches.retrieve(batchId);

    return {
      batchId,
      status: batch.status,
      total: batch.request_counts?.total ?? 0,
      completed: batch.request_counts?.completed ?? 0,
      failed: batch.request_counts?.failed ?? 0,
    };
  }

  /**
   * Cancel a batch job.
   */
  async cancelBatch(batchId: string): Promise<void> {
    await this.client.batches.cancel(batchId);
  }

  /**
   * Parse a response into a DeminifyResult.
   */
  private parseResponse(
    responseText: string,
    context: DeminifyContext,
  ): DeminifyResult {
    // Extract code from markdown code blocks
    const codeMatch = /```(?:javascript|js)?\n?([\s\S]*?)```/.exec(
      responseText,
    );
    if (codeMatch?.[1] == null || codeMatch[1].length === 0) {
      throw new Error("No code block found in response");
    }

    const deminifiedSource = codeMatch[1].trim();

    // Validate the code parses
    if (!validateSource(deminifiedSource)) {
      throw new Error("De-minified code failed to parse");
    }

    // Try to extract metadata JSON
    let suggestedName =
      context.targetFunction.originalName.length > 0
        ? context.targetFunction.originalName
        : "anonymousFunction";
    let confidence = 0.5;
    let parameterNames: Record<string, string> = {};
    let localVariableNames: Record<string, string> = {};

    // Look for JSON after the code block
    const jsonMatch = /```[\s\S]*?```\s*(\{[\s\S]*\})/.exec(responseText);
    if (jsonMatch?.[1] != null && jsonMatch[1].length > 0) {
      try {
        const metadata = JSON.parse(jsonMatch[1]) as {
          suggestedName?: string;
          confidence?: number;
          parameterNames?: Record<string, string>;
          localVariableNames?: Record<string, string>;
        };
        if (
          metadata.suggestedName != null &&
          metadata.suggestedName.length > 0
        ) {
          suggestedName = metadata.suggestedName;
        }
        if (typeof metadata.confidence === "number") {
          confidence = metadata.confidence;
        }
        if (metadata.parameterNames != null) {
          parameterNames = metadata.parameterNames;
        }
        if (metadata.localVariableNames != null) {
          localVariableNames = metadata.localVariableNames;
        }
      } catch {
        // JSON parsing failed, use defaults
      }
    }

    // Try to infer name from the de-minified code if not provided
    if (suggestedName === "anonymousFunction") {
      const funcNameMatch =
        /(?:function|const|let|var)\s+([a-zA-Z_$][\w$]*)/.exec(
          deminifiedSource,
        );
      if (funcNameMatch?.[1] != null && funcNameMatch[1].length > 0) {
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

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Estimate cost for OpenAI batch processing (50% off standard pricing).
 */
export function estimateOpenAIBatchCost(
  inputTokens: number,
  outputTokens: number,
  model: string,
): number {
  const lower = model.toLowerCase();

  // Batch API is 50% off standard pricing
  if (lower.includes("gpt-4o-mini")) {
    // gpt-4o-mini: $0.15/$0.60 per million -> $0.075/$0.30 batch
    return (inputTokens / 1_000_000) * 0.075 + (outputTokens / 1_000_000) * 0.3;
  }
  if (lower.includes("gpt-4o")) {
    // gpt-4o: $2.50/$10 per million -> $1.25/$5 batch
    return (inputTokens / 1_000_000) * 1.25 + (outputTokens / 1_000_000) * 5;
  }
  if (lower.includes("gpt-4.1-nano") || lower.includes("gpt-5-nano")) {
    // Nano models: $0.05/$0.40 per million -> $0.025/$0.20 batch
    return (inputTokens / 1_000_000) * 0.025 + (outputTokens / 1_000_000) * 0.2;
  }
  if (lower.includes("gpt-4.1-mini") || lower.includes("gpt-5-mini")) {
    // Mini models: $0.25/$2 per million -> $0.125/$1 batch
    return (inputTokens / 1_000_000) * 0.125 + (outputTokens / 1_000_000) * 1;
  }
  if (lower.includes("gpt-4.1") || lower.includes("gpt-5")) {
    // Full models: $1.25/$10 per million -> $0.625/$5 batch
    return (inputTokens / 1_000_000) * 0.625 + (outputTokens / 1_000_000) * 5;
  }

  // Default to gpt-4o-mini pricing
  return (inputTokens / 1_000_000) * 0.075 + (outputTokens / 1_000_000) * 0.3;
}
