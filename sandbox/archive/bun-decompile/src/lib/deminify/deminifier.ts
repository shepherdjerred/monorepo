/**
 * Main de-minification orchestrator.
 *
 * The Deminifier class coordinates the de-minification pipeline:
 * 1. Parse source and build call graph
 * 2. Estimate cost and confirm with user
 * 3. Delegate to appropriate processing mode (real-time, batch API, or batch renaming)
 * 4. Return de-minified source
 *
 * Batch mode logic is in batch-mode.ts.
 * Utility functions (createConfig, formatStats, etc.) are in deminify-utils.ts.
 */

import { DeminifyCache, shouldCache } from "./cache.ts";
import {
  buildCallGraph,
  getFunctionContext,
  getProcessingOrder,
} from "./call-graph.ts";
import { ClaudeClient } from "./claude-client.ts";
import { OpenAIClient } from "./openai-client.ts";
import { BatchDeminifyClient } from "./batch-client.ts";
import type { BatchStatus } from "./batch-client.ts";
import { OpenAIBatchClient } from "./openai-batch.ts";
import { reassemble, verifyReassembly } from "./reassembler.ts";
import { BatchModeProcessor } from "./batch-mode.ts";
import type {
  CallGraph,
  CostEstimate,
  DeminifyConfig,
  DeminifyProgress,
  DeminifyResult,
  DeminifyStats,
  ExtendedProgressCallback,
  ExtractedFunction,
  FileContext,
  ProgressCallback,
} from "./types.ts";

/** Batch status callback */
export type BatchStatusCallback = (status: BatchStatus) => void;

/** Options for de-minifying a file */
export type DeminifyFileOptions = {
  /** File name (for context) */
  fileName?: string;
  /** Whether this is the entry point */
  isEntryPoint?: boolean;
  /** Progress callback (basic) */
  onProgress?: ProgressCallback;
  /** Extended progress callback with live stats */
  onExtendedProgress?: ExtendedProgressCallback;
  /** Skip cost confirmation (--yes flag) */
  skipConfirmation?: boolean;
  /** Custom confirmation function */
  confirmCost?: (estimate: CostEstimate) => Promise<boolean>;
  /** Use batch API (50% cheaper, async processing) */
  useBatch?: boolean;
  /** Resume a pending batch by ID */
  resumeBatchId?: string;
  /** Callback for batch status updates */
  onBatchStatus?: BatchStatusCallback;
  /** Output path (for batch state) */
  outputPath?: string;
  /**
   * Use new bottom-up batch renaming with Babel (recommended).
   * This approach:
   * - Processes functions bottom-up (leaves first) for better context
   * - LLM only outputs rename mappings, Babel does actual renaming
   * - Guarantees functional equivalence
   * - Uses ~100-200 API calls instead of 1 per function
   * Default: true
   */
  useBatchRenaming?: boolean;
  /** Maximum tokens per batch for batch renaming (default: 60000) */
  maxBatchTokens?: number;
};

/** Main de-minification orchestrator */
export class Deminifier {
  private readonly config: DeminifyConfig;
  private readonly client: ClaudeClient | OpenAIClient;
  private readonly batchClient: BatchDeminifyClient | null;
  private readonly openAIBatchClient: OpenAIBatchClient | null;
  private readonly cache: DeminifyCache | null;
  private readonly batchMode: BatchModeProcessor;
  private stats: DeminifyStats;

  constructor(config: DeminifyConfig) {
    this.config = config;

    // Select client based on provider
    if (config.provider === "openai") {
      this.client = new OpenAIClient(config);
      this.batchClient = null;
      this.openAIBatchClient = new OpenAIBatchClient(config);
    } else {
      this.client = new ClaudeClient(config);
      this.batchClient = new BatchDeminifyClient(config);
      this.openAIBatchClient = null;
    }

    this.cache = config.cacheEnabled
      ? new DeminifyCache(config.cacheDir, config.model)
      : null;
    this.stats = this.initStats();

    // Create batch mode processor
    this.batchMode = new BatchModeProcessor({
      config,
      batchClient: this.batchClient,
      openAIBatchClient: this.openAIBatchClient,
      cache: this.cache,
    });
  }

  /** Initialize statistics */
  private initStats(): DeminifyStats {
    return {
      functionsProcessed: 0,
      inputTokensUsed: 0,
      outputTokensUsed: 0,
      cacheHits: 0,
      cacheMisses: 0,
      errors: 0,
      averageConfidence: 0,
      timeTaken: 0,
    };
  }

  /** Create a progress emitter that wraps both basic and extended callbacks */
  private createProgressEmitter(
    options: DeminifyFileOptions | undefined,
    confidences: number[],
    startTime: number,
  ): (progress: DeminifyProgress) => void {
    return (progress: DeminifyProgress) => {
      options?.onProgress?.(progress);

      const clientStats = this.client.getStats();
      const avgConf =
        confidences.length > 0
          ? confidences.reduce((a, b) => a + b, 0) / confidences.length
          : 0;

      options?.onExtendedProgress?.({
        ...progress,
        cacheHits: this.stats.cacheHits,
        cacheMisses: this.stats.cacheMisses,
        inputTokens: clientStats.inputTokensUsed,
        outputTokens: clientStats.outputTokensUsed,
        errors: this.stats.errors,
        avgConfidence: avgConf,
        startTime,
        elapsed: Date.now() - startTime,
      });
    };
  }

  /** Parse source into a call graph, wrapping parse errors */
  private parseSourceToGraph(source: string): CallGraph {
    try {
      return buildCallGraph(source);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse source: ${message}`, { cause: error });
    }
  }

  /** Confirm cost with user or skip if configured */
  private async confirmOrSkip(
    options: DeminifyFileOptions | undefined,
    estimate: CostEstimate,
  ): Promise<void> {
    if (options?.skipConfirmation === true) {
      return;
    }
    const confirmed = options?.confirmCost
      ? await options.confirmCost(estimate)
      : await this.defaultConfirmCost(estimate);
    if (!confirmed) {
      throw new Error("De-minification cancelled by user");
    }
  }

  /** De-minify a single JavaScript file */
  async deminifyFile(
    source: string,
    options?: DeminifyFileOptions,
  ): Promise<string> {
    const startTime = Date.now();
    this.stats = this.initStats();
    const confidences: number[] = [];
    const emitProgress = this.createProgressEmitter(
      options,
      confidences,
      startTime,
    );

    // Phase 1: Parse and build call graph
    emitProgress({ phase: "parsing", current: 0, total: 1 });
    const graph = this.parseSourceToGraph(source);

    if (this.config.verbose) {
      console.log(`Parsed ${String(graph.functions.size)} functions`);
    }

    const fileContext: FileContext = {
      fileName: options?.fileName ?? "unknown.js",
      imports: graph.imports,
      exports: graph.exports,
      isEntryPoint: options?.isEntryPoint ?? false,
    };

    const functionsToProcess = this.filterFunctions(graph);
    if (functionsToProcess.length === 0) {
      if (this.config.verbose) {
        console.log("No functions to de-minify");
      }
      return source;
    }

    // Phase 2: Estimate cost and confirm
    emitProgress({
      phase: "analyzing",
      current: 0,
      total: functionsToProcess.length,
    });
    await this.confirmOrSkip(
      options,
      this.client.estimateCost(functionsToProcess),
    );

    // Delegate to appropriate processing mode
    return this.dispatchProcessing({
      source,
      graph,
      functionsToProcess,
      fileContext,
      options,
      confidences,
      emitProgress,
      startTime,
    });
  }

  /** Dispatch to the appropriate processing mode */
  private async dispatchProcessing(opts: {
    source: string;
    graph: CallGraph;
    functionsToProcess: ExtractedFunction[];
    fileContext: FileContext;
    options: DeminifyFileOptions | undefined;
    confidences: number[];
    emitProgress: (progress: DeminifyProgress) => void;
    startTime: number;
  }): Promise<string> {
    const {
      source,
      graph,
      functionsToProcess,
      fileContext,
      options,
      confidences,
      emitProgress,
      startTime,
    } = opts;

    if (
      options?.useBatch === true ||
      (options?.resumeBatchId != null && options.resumeBatchId.length > 0)
    ) {
      return this.batchMode.deminifyFileBatch({
        source,
        graph,
        functionsToProcess,
        fileContext,
        options,
        stats: this.stats,
      });
    }

    if (options?.useBatchRenaming ?? true) {
      return this.batchMode.deminifyFileBatchRenaming({
        source,
        graph,
        options,
        startTime,
        stats: this.stats,
        emitProgress,
      });
    }

    // Real-time mode
    const reassembled = await this.processRealTimeMode({
      source,
      graph,
      functionsToProcess,
      fileContext,
      confidences,
      emitProgress,
    });

    const clientStats = this.client.getStats();
    this.stats.inputTokensUsed = clientStats.inputTokensUsed;
    this.stats.outputTokensUsed = clientStats.outputTokensUsed;
    this.stats.timeTaken = Date.now() - startTime;

    if (confidences.length > 0) {
      this.stats.averageConfidence =
        confidences.reduce((a, b) => a + b, 0) / confidences.length;
    }

    emitProgress({
      phase: "reassembling",
      current: 1,
      total: 1,
      currentItem: "Complete",
    });
    return reassembled;
  }

  /** Process functions in real-time mode (one at a time, in dependency order) */
  private async processRealTimeMode(opts: {
    source: string;
    graph: CallGraph;
    functionsToProcess: ExtractedFunction[];
    fileContext: FileContext;
    confidences: number[];
    emitProgress: (progress: DeminifyProgress) => void;
  }): Promise<string> {
    const {
      source,
      graph,
      functionsToProcess,
      fileContext,
      confidences,
      emitProgress,
    } = opts;
    const processingOrder = getProcessingOrder(graph);
    const results = new Map<string, DeminifyResult>();

    const totalToProcess = functionsToProcess.length;
    let processed = 0;

    for (const funcId of processingOrder) {
      const func = graph.functions.get(funcId);
      if (!func) {
        continue;
      }

      if (!functionsToProcess.some((f) => f.id === funcId)) {
        continue;
      }

      emitProgress({
        phase: "deminifying",
        current: processed,
        total: totalToProcess,
        currentItem: func.originalName || funcId,
      });

      try {
        const result = await this.processFunction(
          func,
          graph,
          results,
          fileContext,
        );
        if (result) {
          results.set(funcId, result);
          confidences.push(result.confidence);
        }
      } catch (error) {
        this.stats.errors++;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error processing ${funcId}: ${message}`);
      }

      processed++;
    }

    emitProgress({ phase: "reassembling", current: 0, total: 1 });

    const reassembled = reassemble(source, graph, results);

    if (!verifyReassembly(reassembled) && this.config.verbose) {
      console.warn("Warning: Reassembled code may have syntax errors");
    }

    return reassembled;
  }

  /** Filter functions to process based on size limits */
  private filterFunctions(graph: CallGraph): ExtractedFunction[] {
    // Find the IIFE wrapper if it exists (CommonJS pattern)
    const sourceLength = graph.source.length;
    const iifeWrapper = [...graph.functions.values()].find((f) => {
      return (
        f.type === "function-expression" &&
        f.start < 50 && // Starts near beginning
        f.end > sourceLength * 0.9 // Spans most of the file
      );
    });
    const iifeWrapperId = iifeWrapper?.id;

    return [...graph.functions.values()].filter((func) => {
      // Skip the IIFE wrapper itself
      if (func.id === iifeWrapperId) {
        return false;
      }

      // Skip deeply nested functions (nested inside a non-wrapper parent)
      if (
        func.parentId != null &&
        func.parentId.length > 0 &&
        func.parentId !== iifeWrapperId
      ) {
        const parent = graph.functions.get(func.parentId);
        if (
          parent?.parentId != null &&
          parent.parentId.length > 0 &&
          parent.parentId !== iifeWrapperId
        ) {
          return false;
        }
      }

      // Skip by size
      if (func.source.length < this.config.minFunctionSize) {
        return false;
      }
      if (func.source.length > this.config.maxFunctionSize) {
        return false;
      }

      return true;
    });
  }

  /** Process a single function */
  private async processFunction(
    func: ExtractedFunction,
    graph: CallGraph,
    results: Map<string, DeminifyResult>,
    fileContext: FileContext,
  ): Promise<DeminifyResult | null> {
    // Check cache first
    if (this.cache && shouldCache(func)) {
      const cached = await this.cache.get(func);
      if (cached) {
        this.stats.cacheHits++;
        this.stats.functionsProcessed++;
        return cached;
      }
      this.stats.cacheMisses++;
    }

    // Build context
    const context = getFunctionContext(graph, func.id, results, fileContext);

    // Call Claude
    const result = await this.client.deminifyFunction(context);
    this.stats.functionsProcessed++;

    // Cache result
    if (this.cache && shouldCache(func)) {
      await this.cache.set(func, result);
    }

    return result;
  }

  /** Default cost confirmation (always returns true in non-interactive mode) */
  private defaultConfirmCost(_estimate: CostEstimate): Promise<boolean> {
    return Promise.resolve(true);
  }

  /** Get statistics */
  getStats(): DeminifyStats {
    return { ...this.stats };
  }

  /** Estimate cost without processing */
  estimateCost(source: string): CostEstimate {
    const graph = buildCallGraph(source);
    const functions = this.filterFunctions(graph);
    return this.client.estimateCost(functions);
  }
}
