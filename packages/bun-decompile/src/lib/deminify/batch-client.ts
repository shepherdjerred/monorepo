import Anthropic from "@anthropic-ai/sdk";
import {
  getSimpleFunctionPrompt,
  getFunctionPrompt,
  getSystemPrompt,
} from "./prompt-templates.ts";
import { parseLLMResponse, getErrorMessage } from "./response-parser.ts";
import type {
  DeminifyConfig,
  DeminifyContext,
  DeminifyResult,
} from "./types.ts";

/** Batch processing status */
export type BatchStatus = {
  batchId: string;
  status: "in_progress" | "canceling" | "ended";
  total: number;
  succeeded: number;
  errored: number;
  processing: number;
};

/** Batch processing callbacks */
export type BatchCallbacks = {
  onStatusUpdate?: (status: BatchStatus) => void;
  onComplete?: (results: Map<string, DeminifyResult>) => void;
  onError?: (error: Error) => void;
};

/** Client for batch de-minification using Anthropic's Message Batches API */
export class BatchDeminifyClient {
  private readonly client: Anthropic;
  private readonly config: DeminifyConfig;

  constructor(config: DeminifyConfig) {
    this.config = config;
    this.client = new Anthropic({
      apiKey: config.apiKey,
    });
  }

  /** Create a batch request for all function contexts */
  async createBatch(contexts: Map<string, DeminifyContext>): Promise<string> {
    const requests: Anthropic.Beta.Messages.BatchCreateParams.Request[] = [];
    const systemPrompt = getSystemPrompt();

    for (const [funcId, context] of contexts) {
      const userPrompt =
        context.targetFunction.source.length < 200
          ? getSimpleFunctionPrompt(context.targetFunction.source)
          : getFunctionPrompt(context);

      requests.push({
        custom_id: funcId,
        params: {
          model: this.config.model,
          max_tokens: this.config.maxTokens,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        },
      });
    }

    if (this.config.verbose) {
      console.log(`Creating batch with ${String(requests.length)} requests...`);
    }

    const batch = await this.client.beta.messages.batches.create({ requests });

    if (this.config.verbose) {
      console.log(`Batch created: ${batch.id}`);
    }

    return batch.id;
  }

  /** Poll for batch completion */
  async waitForCompletion(
    batchId: string,
    callbacks?: BatchCallbacks,
    pollIntervalMs = 30_000,
  ): Promise<void> {
    let batch = await this.client.beta.messages.batches.retrieve(batchId);

    while (batch.processing_status === "in_progress") {
      const status: BatchStatus = {
        batchId,
        status: batch.processing_status,
        total:
          batch.request_counts.processing +
          batch.request_counts.succeeded +
          batch.request_counts.errored +
          batch.request_counts.canceled +
          batch.request_counts.expired,
        succeeded: batch.request_counts.succeeded,
        errored: batch.request_counts.errored,
        processing: batch.request_counts.processing,
      };

      callbacks?.onStatusUpdate?.(status);

      await this.sleep(pollIntervalMs);
      batch = await this.client.beta.messages.batches.retrieve(batchId);
    }

    // Final status update
    const finalStatus: BatchStatus = {
      batchId,
      status: batch.processing_status,
      total:
        batch.request_counts.succeeded +
        batch.request_counts.errored +
        batch.request_counts.canceled +
        batch.request_counts.expired,
      succeeded: batch.request_counts.succeeded,
      errored: batch.request_counts.errored,
      processing: 0,
    };

    callbacks?.onStatusUpdate?.(finalStatus);
  }

  /** Retrieve and parse results from a completed batch */
  async getResults(
    batchId: string,
    contexts: Map<string, DeminifyContext>,
  ): Promise<Map<string, DeminifyResult>> {
    const results = new Map<string, DeminifyResult>();
    const resultStream =
      await this.client.beta.messages.batches.results(batchId);

    for await (const entry of resultStream) {
      const funcId = entry.custom_id;
      const context = contexts.get(funcId);

      if (!context) {
        if (this.config.verbose) {
          console.warn(`Unknown function ID in results: ${funcId}`);
        }
        continue;
      }

      if (entry.result.type === "succeeded") {
        try {
          const result = this.parseSucceededResult(
            entry.result.message,
            context,
          );
          if (result) {
            results.set(funcId, result);
          }
        } catch (error) {
          if (this.config.verbose) {
            console.error(
              `Failed to parse result for ${funcId}: ${getErrorMessage(error)}`,
            );
          }
        }
      } else if (entry.result.type === "errored" && this.config.verbose) {
        console.error(
          `Batch error for ${funcId}: ${JSON.stringify(entry.result.error)}`,
        );
      }
    }

    return results;
  }

  /** Get the status of a batch */
  async getBatchStatus(batchId: string): Promise<BatchStatus> {
    const batch = await this.client.beta.messages.batches.retrieve(batchId);

    return {
      batchId,
      status: batch.processing_status,
      total:
        batch.request_counts.processing +
        batch.request_counts.succeeded +
        batch.request_counts.errored +
        batch.request_counts.canceled +
        batch.request_counts.expired,
      succeeded: batch.request_counts.succeeded,
      errored: batch.request_counts.errored,
      processing: batch.request_counts.processing,
    };
  }

  /** Parse a succeeded message into a DeminifyResult */
  private parseSucceededResult(
    message: { content: { type: string; text?: string }[] },
    context: DeminifyContext,
  ): DeminifyResult | null {
    const content = message.content[0];
    if (
      content?.type !== "text" ||
      content.text == null ||
      content.text.length === 0
    ) {
      throw new Error("Unexpected response type");
    }

    return parseLLMResponse(content.text, context);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/** Estimate cost for batch processing (50% off standard pricing) */
export function estimateBatchCost(
  inputTokens: number,
  outputTokens: number,
  model: string,
): number {
  // Batch API is 50% off standard pricing
  if (model.includes("haiku")) {
    // Haiku 4.5: $1/$5 per million -> $0.50/$2.50 batch
    return (inputTokens / 1_000_000) * 0.5 + (outputTokens / 1_000_000) * 2.5;
  } else if (model.includes("sonnet")) {
    // Sonnet 4: $3/$15 per million -> $1.50/$7.50 batch
    return (inputTokens / 1_000_000) * 1.5 + (outputTokens / 1_000_000) * 7.5;
  } else if (model.includes("opus")) {
    // Opus 4.5: $5/$25 per million -> $2.50/$12.50 batch
    return (inputTokens / 1_000_000) * 2.5 + (outputTokens / 1_000_000) * 12.5;
  }
  // Default to Haiku pricing
  return (inputTokens / 1_000_000) * 0.5 + (outputTokens / 1_000_000) * 2.5;
}
