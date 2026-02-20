/**
 * Batch mode de-minification methods.
 *
 * Handles:
 * - Anthropic/OpenAI batch API submissions
 * - Batch status polling and result retrieval
 * - Batch resume from saved state
 * - Bottom-up batch renaming with Babel
 */

import type { DeminifyCache } from "./cache.ts";
import { shouldCache, hashSource } from "./cache.ts";
import { getFunctionContext } from "./call-graph.ts";
import type { BatchDeminifyClient, BatchStatus } from "./batch-client.ts";
import type { OpenAIBatchClient, OpenAIBatchStatus } from "./openai-batch.ts";
import {
  saveBatchState,
  loadBatchState,
  clearBatchState,
  formatBatchState,
  getProjectId,
} from "./batch-state.ts";
import { reassemble, verifyReassembly } from "./reassembler.ts";
import { BatchProcessor } from "./batch-processor.ts";
import { FunctionCache } from "./function-cache.ts";
import type {
  CallGraph,
  DeminifyConfig,
  DeminifyContext,
  DeminifyProgress,
  DeminifyResult,
  DeminifyStats,
  ExtractedFunction,
  FileContext,
} from "./types.ts";
import type { DeminifyFileOptions } from "./deminifier.ts";

/** Convert OpenAI batch status to common BatchStatus */
function toCommonStatus(status: OpenAIBatchStatus): BatchStatus {
  return {
    batchId: status.batchId,
    status: status.status === "completed" ? "ended" : "in_progress",
    total: status.total,
    succeeded: status.completed,
    errored: status.failed,
    processing: status.total - status.completed - status.failed,
  };
}

/** Format batch progress for terminal display */
function formatBatchProgress(
  completed: number,
  total: number,
  failed: number,
): string {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return `\r  Progress: ${String(completed)}/${String(total)} (${String(pct)}%) | Errors: ${String(failed)}     `;
}

/** Batch mode orchestrator for de-minification. Manages batch API submissions, polling, and result retrieval. */
export class BatchModeProcessor {
  private readonly config: DeminifyConfig;
  private readonly batchClient: BatchDeminifyClient | null;
  private readonly openAIBatchClient: OpenAIBatchClient | null;
  private readonly cache: DeminifyCache | null;

  constructor(opts: {
    config: DeminifyConfig;
    batchClient: BatchDeminifyClient | null;
    openAIBatchClient: OpenAIBatchClient | null;
    cache: DeminifyCache | null;
  }) {
    this.config = opts.config;
    this.batchClient = opts.batchClient;
    this.openAIBatchClient = opts.openAIBatchClient;
    this.cache = opts.cache;
  }

  /**
   * De-minify using bottom-up batch renaming with Babel.
   *
   * Key algorithm:
   * 1. Process functions bottom-up (leaves first)
   * 2. LLM only outputs rename mappings
   * 3. Babel applies renames using scope.rename()
   * 4. After each round, renames are applied so parents see renamed callees
   *
   * This guarantees functional equivalence and dramatically reduces API calls.
   */
  async deminifyFileBatchRenaming(opts: {
    source: string;
    graph: CallGraph;
    options: DeminifyFileOptions | undefined;
    startTime: number;
    stats: DeminifyStats;
    emitProgress: (progress: DeminifyProgress) => void;
  }): Promise<string> {
    const { source, graph, options, startTime, stats, emitProgress } = opts;
    // Create function cache for batch processor
    const functionCache = new FunctionCache(
      `${this.config.cacheDir}/functions`,
      this.config.model,
    );
    await functionCache.init();

    // Create batch processor
    const processor = new BatchProcessor(this.config, functionCache);

    // Set up logging if verbose
    if (this.config.verbose) {
      const logFile = `${this.config.cacheDir}/llm-requests.log`;
      processor.setLogFile(logFile);
      console.log(`Logging LLM requests to: ${logFile}`);
    }

    // Process all functions bottom-up
    emitProgress({
      phase: "deminifying",
      current: 0,
      total: graph.functions.size,
      currentItem: "Starting batch processing...",
    });

    const result = await processor.processAll(source, graph, {
      // maxBatchTokens: computed from model context limit if not specified
      ...(options?.maxBatchTokens === undefined
        ? {}
        : { maxBatchTokens: options.maxBatchTokens }),
      verbose: this.config.verbose,
      onProgress: (progress) => {
        const progressUpdate: DeminifyProgress = {
          phase: progress.phase,
          current: progress.current,
          total: progress.total,
        };
        if (progress.currentItem != null && progress.currentItem.length > 0) {
          progressUpdate.currentItem = progress.currentItem;
        }
        emitProgress(progressUpdate);

        // Update stats from progress
        stats.cacheHits = progress.cacheHits;
        stats.cacheMisses = progress.cacheMisses;
        stats.errors = progress.errors;
        stats.inputTokensUsed = progress.inputTokens;
        stats.outputTokensUsed = progress.outputTokens;
        stats.averageConfidence = progress.avgConfidence;
      },
    });

    // Get final stats from processor
    const processorStats = processor.getStats();
    stats.functionsProcessed = processorStats.processed;
    stats.cacheHits = processorStats.cacheHits;
    stats.cacheMisses = processorStats.cacheMisses;
    stats.errors = processorStats.errors;
    stats.inputTokensUsed = processorStats.inputTokens;
    stats.outputTokensUsed = processorStats.outputTokens;
    stats.timeTaken = Date.now() - startTime;

    // Emit final progress
    emitProgress({
      phase: "reassembling",
      current: 1,
      total: 1,
      currentItem: "Complete",
    });

    return result;
  }

  /** De-minify using batch API (50% cheaper, async processing) */
  async deminifyFileBatch(opts: {
    source: string;
    graph: CallGraph;
    functionsToProcess: ExtractedFunction[];
    fileContext: FileContext;
    options: DeminifyFileOptions;
    stats: DeminifyStats;
  }): Promise<string> {
    const { source, graph, functionsToProcess, fileContext, options, stats } =
      opts;
    // Check that we have a batch client for the provider
    const isOpenAI = this.config.provider === "openai";
    if (isOpenAI && !this.openAIBatchClient) {
      throw new Error("OpenAI batch client not initialized");
    }
    if (!isOpenAI && !this.batchClient) {
      throw new Error("Anthropic batch client not initialized");
    }

    const fileName = options.fileName ?? "unknown.js";

    // Check for resume
    if (options.resumeBatchId != null && options.resumeBatchId.length > 0) {
      console.log(`Resuming batch: ${options.resumeBatchId}`);
      return this.resumeBatch({
        source,
        graph,
        functionsToProcess,
        fileContext,
        batchId: options.resumeBatchId,
        options,
        stats,
      });
    }

    // Check for existing pending batch
    const existingState = await loadBatchState(this.config.cacheDir);
    if (existingState?.sourceHash === hashSource(source)) {
      console.log("\nFound pending batch for this file:");
      console.log(formatBatchState(existingState));
      console.log(
        "\nUse --resume to continue, or delete the cache to start fresh.",
      );
      throw new Error("Pending batch exists. Use --resume or clear cache.");
    }

    // Build all contexts upfront (batch can't do incremental context)
    console.log(
      `\nBuilding contexts for ${String(functionsToProcess.length)} functions...`,
    );
    const contexts = new Map<string, DeminifyContext>();

    for (const func of functionsToProcess) {
      const context = getFunctionContext(
        graph,
        func.id,
        new Map(),
        fileContext,
      );
      contexts.set(func.id, context);
    }

    // Create batch using the appropriate client
    const providerName = isOpenAI ? "OpenAI" : "Anthropic";
    console.log(`Submitting batch to ${providerName} API...`);

    let batchId: string;
    if (isOpenAI) {
      if (!this.openAIBatchClient) {
        throw new Error("OpenAI batch client not initialized");
      }
      batchId = await this.openAIBatchClient.createBatch(contexts);
    } else {
      if (!this.batchClient) {
        throw new Error("Anthropic batch client not initialized");
      }
      batchId = await this.batchClient.createBatch(contexts);
    }

    // Save state for resume
    await saveBatchState(
      {
        batchId,
        sourceHash: hashSource(source),
        outputPath: options.outputPath ?? "./deminified",
        createdAt: Date.now(),
        model: this.config.model,
        functionCount: functionsToProcess.length,
        fileName,
        projectId: getProjectId(),
      },
      this.config.cacheDir,
    );

    console.log(`\nBatch submitted: ${batchId}`);
    console.log("Waiting for results (typically 30-60 minutes)...\n");

    // Poll for completion and get results
    const results = await this.pollAndRetrieveBatchResults(
      batchId,
      isOpenAI,
      contexts,
      options,
    );

    // Update stats and cache results
    await this.finalizeBatchResults(results, graph, stats);

    // Reassemble
    console.log("Reassembling code...");
    const reassembled = reassemble(source, graph, results);

    if (!verifyReassembly(reassembled)) {
      console.warn("Warning: Reassembled code may have syntax errors");
    }

    return reassembled;
  }

  /** Poll for batch completion and retrieve results */
  private async pollAndRetrieveBatchResults(
    batchId: string,
    isOpenAI: boolean,
    contexts: Map<string, DeminifyContext>,
    options: DeminifyFileOptions,
  ): Promise<Map<string, DeminifyResult>> {
    if (isOpenAI) {
      if (!this.openAIBatchClient) {
        throw new Error("OpenAI batch client not initialized");
      }
      await this.openAIBatchClient.waitForCompletion(batchId, {
        onStatusUpdate: (status: OpenAIBatchStatus) => {
          options.onBatchStatus?.(toCommonStatus(status));
          if (!options.onBatchStatus) {
            process.stdout.write(
              formatBatchProgress(
                status.completed,
                status.total,
                status.failed,
              ),
            );
          }
        },
      });
    } else {
      if (!this.batchClient) {
        throw new Error("Anthropic batch client not initialized");
      }
      await this.batchClient.waitForCompletion(batchId, {
        onStatusUpdate: (status) => {
          options.onBatchStatus?.(status);
          if (!options.onBatchStatus) {
            process.stdout.write(
              formatBatchProgress(
                status.succeeded,
                status.total,
                status.errored,
              ),
            );
          }
        },
      });
    }

    console.log("\n\nBatch complete! Retrieving results...");

    let results: Map<string, DeminifyResult>;
    if (isOpenAI) {
      if (!this.openAIBatchClient) {
        throw new Error("OpenAI batch client not initialized");
      }
      results = await this.openAIBatchClient.getResults(batchId, contexts);
    } else {
      if (!this.batchClient) {
        throw new Error("Anthropic batch client not initialized");
      }
      results = await this.batchClient.getResults(batchId, contexts);
    }

    console.log(`Retrieved ${String(results.size)} results`);
    return results;
  }

  /** Update stats, cache results, and clear batch state */
  private async finalizeBatchResults(
    results: Map<string, DeminifyResult>,
    graph: CallGraph,
    stats: DeminifyStats,
  ): Promise<void> {
    stats.functionsProcessed = results.size;
    for (const result of results.values()) {
      if (result.confidence > 0) {
        stats.averageConfidence += result.confidence;
      }
    }
    if (results.size > 0) {
      stats.averageConfidence /= results.size;
    }

    if (this.cache) {
      for (const [funcId, result] of results) {
        const func = graph.functions.get(funcId);
        if (func && shouldCache(func)) {
          await this.cache.set(func, result);
        }
      }
    }

    await clearBatchState(this.config.cacheDir);
  }

  /** Wait for an OpenAI batch to finish processing if still in progress */
  private async waitForOpenAIBatchIfNeeded(
    batchId: string,
    options: DeminifyFileOptions,
  ): Promise<void> {
    if (!this.openAIBatchClient) {
      throw new Error("OpenAI batch client not initialized");
    }
    const status = await this.openAIBatchClient.getBatchStatus(batchId);
    if (
      status.status !== "in_progress" &&
      status.status !== "validating" &&
      status.status !== "finalizing"
    ) {
      return;
    }
    console.log(
      `Batch still processing: ${String(status.completed)}/${String(status.total)} complete`,
    );
    console.log("Waiting for completion...\n");
    await this.openAIBatchClient.waitForCompletion(batchId, {
      onStatusUpdate: (s: OpenAIBatchStatus) => {
        options.onBatchStatus?.(toCommonStatus(s));
        if (!options.onBatchStatus) {
          process.stdout.write(
            formatBatchProgress(s.completed, s.total, s.failed),
          );
        }
      },
    });
  }

  /** Wait for an Anthropic batch to finish processing if still in progress */
  private async waitForAnthropicBatchIfNeeded(
    batchId: string,
    options: DeminifyFileOptions,
  ): Promise<void> {
    if (!this.batchClient) {
      throw new Error("Anthropic batch client not initialized");
    }
    const status = await this.batchClient.getBatchStatus(batchId);
    if (status.status !== "in_progress") {
      return;
    }
    console.log(
      `Batch still processing: ${String(status.succeeded)}/${String(status.total)} complete`,
    );
    console.log("Waiting for completion...\n");
    await this.batchClient.waitForCompletion(batchId, {
      onStatusUpdate: (s) => {
        options.onBatchStatus?.(s);
        if (!options.onBatchStatus) {
          process.stdout.write(
            formatBatchProgress(s.succeeded, s.total, s.errored),
          );
        }
      },
    });
  }

  /** Resume a pending batch */
  private async resumeBatch(opts: {
    source: string;
    graph: CallGraph;
    functionsToProcess: ExtractedFunction[];
    fileContext: FileContext;
    batchId: string;
    options: DeminifyFileOptions;
    stats: DeminifyStats;
  }): Promise<string> {
    const {
      source,
      graph,
      functionsToProcess,
      fileContext,
      batchId,
      options,
      stats,
    } = opts;
    const isOpenAI = this.config.provider === "openai";

    // Rebuild contexts
    const contexts = new Map<string, DeminifyContext>();
    for (const func of functionsToProcess) {
      contexts.set(
        func.id,
        getFunctionContext(graph, func.id, new Map(), fileContext),
      );
    }

    // Wait for batch to complete if still processing
    await (isOpenAI
      ? this.waitForOpenAIBatchIfNeeded(batchId, options)
      : this.waitForAnthropicBatchIfNeeded(batchId, options));

    console.log("\n\nRetrieving results...");

    // Get results using appropriate client
    const results = isOpenAI
      ? await this.getOpenAIResults(batchId, contexts)
      : await this.getAnthropicResults(batchId, contexts);

    console.log(`Retrieved ${String(results.size)} results`);

    stats.functionsProcessed = results.size;

    if (this.cache) {
      for (const [funcId, result] of results) {
        const func = graph.functions.get(funcId);
        if (func && shouldCache(func)) {
          await this.cache.set(func, result);
        }
      }
    }

    await clearBatchState(this.config.cacheDir);

    console.log("Reassembling code...");
    const reassembled = reassemble(source, graph, results);

    if (!verifyReassembly(reassembled)) {
      console.warn("Warning: Reassembled code may have syntax errors");
    }

    return reassembled;
  }

  /** Get results from OpenAI batch client */
  private async getOpenAIResults(
    batchId: string,
    contexts: Map<string, DeminifyContext>,
  ): Promise<Map<string, DeminifyResult>> {
    if (!this.openAIBatchClient) {
      throw new Error("OpenAI batch client not initialized");
    }
    return this.openAIBatchClient.getResults(batchId, contexts);
  }

  /** Get results from Anthropic batch client */
  private async getAnthropicResults(
    batchId: string,
    contexts: Map<string, DeminifyContext>,
  ): Promise<Map<string, DeminifyResult>> {
    if (!this.batchClient) {
      throw new Error("Anthropic batch client not initialized");
    }
    return this.batchClient.getResults(batchId, contexts);
  }
}
