import { DeminifyCache, shouldCache, hashSource } from "./cache.ts";
import {
  buildCallGraph,
  getFunctionContext,
  getProcessingOrder,
} from "./call-graph.ts";
import { ClaudeClient, formatCostEstimate } from "./claude-client.ts";
import { OpenAIClient } from "./openai-client.ts";
import { BatchDeminifyClient } from "./batch-client.ts";
import type { BatchStatus } from "./batch-client.ts";
import { OpenAIBatchClient } from "./openai-batch.ts";
import type { OpenAIBatchStatus } from "./openai-batch.ts";
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
  CostEstimate,
  DeminifyConfig,
  DeminifyContext,
  DeminifyProgress,
  DeminifyResult,
  DeminifyStats,
  ExtendedProgress,
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

  /** De-minify a single JavaScript file */
  async deminifyFile(
    source: string,
    options?: DeminifyFileOptions,
  ): Promise<string> {
    const startTime = Date.now();
    this.stats = this.initStats();

    const fileName = options?.fileName ?? "unknown.js";
    const isEntryPoint = options?.isEntryPoint ?? false;
    const onProgress = options?.onProgress;
    const onExtendedProgress = options?.onExtendedProgress;

    // Track confidences for live average
    const confidences: number[] = [];

    // Helper to emit progress (both callbacks)
    const emitProgress = (progress: DeminifyProgress) => {
      onProgress?.(progress);

      // Build extended progress with live stats
      const clientStats = this.client.getStats();
      const avgConf =
        confidences.length > 0
          ? confidences.reduce((a, b) => a + b, 0) / confidences.length
          : 0;

      const extendedProgress: ExtendedProgress = {
        ...progress,
        cacheHits: this.stats.cacheHits,
        cacheMisses: this.stats.cacheMisses,
        inputTokens: clientStats.inputTokensUsed,
        outputTokens: clientStats.outputTokensUsed,
        errors: this.stats.errors,
        avgConfidence: avgConf,
        startTime,
        elapsed: Date.now() - startTime,
      };

      onExtendedProgress?.(extendedProgress);
    };

    // Phase 1: Parse and build call graph
    emitProgress({ phase: "parsing", current: 0, total: 1 });

    let graph: CallGraph;
    try {
      graph = buildCallGraph(source);
    } catch (error) {
      throw new Error(`Failed to parse source: ${(error as Error).message}`, {
        cause: error,
      });
    }

    if (this.config.verbose) {
      console.log(`Parsed ${String(graph.functions.size)} functions`);
    }

    // Build file context
    const fileContext: FileContext = {
      fileName,
      imports: graph.imports,
      exports: graph.exports,
      isEntryPoint,
    };

    // Filter functions by size
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

    const estimate = this.client.estimateCost(functionsToProcess);

    if (!options?.skipConfirmation) {
      const confirmed = options?.confirmCost
        ? await options.confirmCost(estimate)
        : await this.defaultConfirmCost(estimate);

      if (!confirmed) {
        throw new Error("De-minification cancelled by user");
      }
    }

    // Use batch mode if requested (Anthropic batch API)
    if (options?.useBatch || options?.resumeBatchId) {
      return this.deminifyFileBatch(
        source,
        graph,
        functionsToProcess,
        fileContext,
        options,
      );
    }

    // Use new bottom-up batch renaming by default (recommended)
    const useBatchRenaming = options?.useBatchRenaming ?? true;
    if (useBatchRenaming) {
      return this.deminifyFileBatchRenaming(
        source,
        graph,
        options,
        startTime,
        emitProgress,
      );
    }

    // Phase 3: Process functions (real-time mode)
    const processingOrder = getProcessingOrder(graph);
    const results = new Map<string, DeminifyResult>();

    const totalToProcess = functionsToProcess.length;
    let processed = 0;

    // Process functions in dependency order
    for (const funcId of processingOrder) {
      const func = graph.functions.get(funcId);
      if (!func) {
        continue;
      }

      // Skip if not in our filtered list
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
        console.error(
          `Error processing ${funcId}: ${(error as Error).message}`,
        );
      }

      processed++;
    }

    // Phase 4: Reassemble
    emitProgress({ phase: "reassembling", current: 0, total: 1 });

    const reassembled = reassemble(source, graph, results);

    // Verify result
    if (!verifyReassembly(reassembled) && this.config.verbose) {
      console.warn("Warning: Reassembled code may have syntax errors");
    }

    // Update final stats
    const clientStats = this.client.getStats();
    this.stats.inputTokensUsed = clientStats.inputTokensUsed;
    this.stats.outputTokensUsed = clientStats.outputTokensUsed;
    this.stats.timeTaken = Date.now() - startTime;

    if (confidences.length > 0) {
      this.stats.averageConfidence =
        confidences.reduce((a, b) => a + b, 0) / confidences.length;
    }

    // Emit final progress
    emitProgress({
      phase: "reassembling",
      current: 1,
      total: 1,
      currentItem: "Complete",
    });

    return reassembled;
  }

  /** Filter functions to process based on size limits */
  private filterFunctions(graph: CallGraph): ExtractedFunction[] {
    // Find the IIFE wrapper if it exists (CommonJS pattern)
    // It's typically a function-expression that starts near position 0 and spans most of the source
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
      if (func.parentId && func.parentId !== iifeWrapperId) {
        // Check if the parent's parent is also not the wrapper (deeply nested)
        const parent = graph.functions.get(func.parentId);
        if (parent?.parentId && parent.parentId !== iifeWrapperId) {
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
  private async deminifyFileBatchRenaming(
    source: string,
    graph: CallGraph,
    options: DeminifyFileOptions | undefined,
    startTime: number,
    emitProgress: (progress: DeminifyProgress) => void,
  ): Promise<string> {
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
        if (progress.currentItem) {
          progressUpdate.currentItem = progress.currentItem;
        }
        emitProgress(progressUpdate);

        // Update stats from progress
        this.stats.cacheHits = progress.cacheHits;
        this.stats.cacheMisses = progress.cacheMisses;
        this.stats.errors = progress.errors;
        this.stats.inputTokensUsed = progress.inputTokens;
        this.stats.outputTokensUsed = progress.outputTokens;
        this.stats.averageConfidence = progress.avgConfidence;
      },
    });

    // Get final stats from processor
    const processorStats = processor.getStats();
    this.stats.functionsProcessed = processorStats.processed;
    this.stats.cacheHits = processorStats.cacheHits;
    this.stats.cacheMisses = processorStats.cacheMisses;
    this.stats.errors = processorStats.errors;
    this.stats.inputTokensUsed = processorStats.inputTokens;
    this.stats.outputTokensUsed = processorStats.outputTokens;
    this.stats.timeTaken = Date.now() - startTime;

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
  private async deminifyFileBatch(
    source: string,
    graph: CallGraph,
    functionsToProcess: ExtractedFunction[],
    fileContext: FileContext,
    options: DeminifyFileOptions,
  ): Promise<string> {
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
    if (options.resumeBatchId) {
      console.log(`Resuming batch: ${options.resumeBatchId}`);
      return this.resumeBatch(
        source,
        graph,
        functionsToProcess,
        fileContext,
        options.resumeBatchId,
        options,
      );
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
      // For batch, we use empty results since we can't do incremental
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

    // Save state for resume (includes projectId for isolation in shared environments)
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

    // Poll for completion using the appropriate client
    if (isOpenAI) {
      if (!this.openAIBatchClient) {
        throw new Error("OpenAI batch client not initialized");
      }
      await this.openAIBatchClient.waitForCompletion(batchId, {
        onStatusUpdate: (status: OpenAIBatchStatus) => {
          // Convert to common format for callback
          const commonStatus: BatchStatus = {
            batchId: status.batchId,
            status: status.status === "completed" ? "ended" : "in_progress",
            total: status.total,
            succeeded: status.completed,
            errored: status.failed,
            processing: status.total - status.completed - status.failed,
          };
          options.onBatchStatus?.(commonStatus);
          if (!options.onBatchStatus) {
            const pct =
              status.total > 0
                ? Math.round((status.completed / status.total) * 100)
                : 0;
            process.stdout.write(
              `\r  Progress: ${String(status.completed)}/${String(status.total)} (${String(pct)}%) | Errors: ${String(status.failed)}     `,
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
            const pct =
              status.total > 0
                ? Math.round((status.succeeded / status.total) * 100)
                : 0;
            process.stdout.write(
              `\r  Progress: ${String(status.succeeded)}/${String(status.total)} (${String(pct)}%) | Errors: ${String(status.errored)}     `,
            );
          }
        },
      });
    }

    console.log("\n\nBatch complete! Retrieving results...");

    // Get results using the appropriate client
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

    // Update stats
    this.stats.functionsProcessed = results.size;
    for (const result of results.values()) {
      if (result.confidence > 0) {
        this.stats.averageConfidence += result.confidence;
      }
    }
    if (results.size > 0) {
      this.stats.averageConfidence /= results.size;
    }

    // Cache results
    if (this.cache) {
      for (const [funcId, result] of results) {
        const func = graph.functions.get(funcId);
        if (func && shouldCache(func)) {
          await this.cache.set(func, result);
        }
      }
    }

    // Clear saved state
    await clearBatchState(this.config.cacheDir);

    // Reassemble
    console.log("Reassembling code...");
    const reassembled = reassemble(source, graph, results);

    if (!verifyReassembly(reassembled)) {
      console.warn("Warning: Reassembled code may have syntax errors");
    }

    return reassembled;
  }

  /** Resume a pending batch */
  private async resumeBatch(
    source: string,
    graph: CallGraph,
    functionsToProcess: ExtractedFunction[],
    fileContext: FileContext,
    batchId: string,
    options: DeminifyFileOptions,
  ): Promise<string> {
    const isOpenAI = this.config.provider === "openai";
    if (isOpenAI && !this.openAIBatchClient) {
      throw new Error("OpenAI batch client not initialized");
    }
    if (!isOpenAI && !this.batchClient) {
      throw new Error("Anthropic batch client not initialized");
    }

    // Rebuild contexts
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

    // Check batch status using appropriate client
    if (isOpenAI) {
      if (!this.openAIBatchClient) {
        throw new Error("OpenAI batch client not initialized");
      }
      const status = await this.openAIBatchClient.getBatchStatus(batchId);

      if (
        status.status === "in_progress" ||
        status.status === "validating" ||
        status.status === "finalizing"
      ) {
        console.log(
          `Batch still processing: ${String(status.completed)}/${String(status.total)} complete`,
        );
        console.log("Waiting for completion...\n");

        await this.openAIBatchClient.waitForCompletion(batchId, {
          onStatusUpdate: (s: OpenAIBatchStatus) => {
            const commonStatus: BatchStatus = {
              batchId: s.batchId,
              status: s.status === "completed" ? "ended" : "in_progress",
              total: s.total,
              succeeded: s.completed,
              errored: s.failed,
              processing: s.total - s.completed - s.failed,
            };
            options.onBatchStatus?.(commonStatus);
            if (!options.onBatchStatus) {
              const pct =
                s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0;
              process.stdout.write(
                `\r  Progress: ${String(s.completed)}/${String(s.total)} (${String(pct)}%) | Errors: ${String(s.failed)}     `,
              );
            }
          },
        });
      }
    } else {
      if (!this.batchClient) {
        throw new Error("Anthropic batch client not initialized");
      }
      const status = await this.batchClient.getBatchStatus(batchId);

      if (status.status === "in_progress") {
        console.log(
          `Batch still processing: ${String(status.succeeded)}/${String(status.total)} complete`,
        );
        console.log("Waiting for completion...\n");

        await this.batchClient.waitForCompletion(batchId, {
          onStatusUpdate: (s) => {
            options.onBatchStatus?.(s);
            if (!options.onBatchStatus) {
              const pct =
                s.total > 0 ? Math.round((s.succeeded / s.total) * 100) : 0;
              process.stdout.write(
                `\r  Progress: ${String(s.succeeded)}/${String(s.total)} (${String(pct)}%) | Errors: ${String(s.errored)}     `,
              );
            }
          },
        });
      }
    }

    console.log("\n\nRetrieving results...");

    // Get results using appropriate client
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

    // Update stats
    this.stats.functionsProcessed = results.size;

    // Cache results
    if (this.cache) {
      for (const [funcId, result] of results) {
        const func = graph.functions.get(funcId);
        if (func && shouldCache(func)) {
          await this.cache.set(func, result);
        }
      }
    }

    // Clear saved state
    await clearBatchState(this.config.cacheDir);

    // Reassemble
    console.log("Reassembling code...");
    const reassembled = reassemble(source, graph, results);

    if (!verifyReassembly(reassembled)) {
      console.warn("Warning: Reassembled code may have syntax errors");
    }

    return reassembled;
  }

  /** Default cost confirmation (always returns true in non-interactive mode) */
  private defaultConfirmCost(_estimate: CostEstimate): Promise<boolean> {
    // In CLI mode, this will be overridden with interactive confirmation
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

/** High-level function for simple usage */
export async function deminify(
  source: string,
  config: DeminifyConfig,
  options?: DeminifyFileOptions,
): Promise<string> {
  const deminifier = new Deminifier(config);
  return deminifier.deminifyFile(source, options);
}

/** Create default config with API key and output path */
export function createConfig(
  apiKey: string,
  outputPath: string,
  overrides?: Partial<DeminifyConfig>,
): DeminifyConfig {
  const cacheDir = `${outputPath}/cache`;

  const defaults: Omit<DeminifyConfig, "apiKey"> = {
    provider: "openai",
    model: "gpt-5-nano",
    maxTokens: 16_384, // GPT-5 nano uses reasoning tokens, needs more headroom
    cacheEnabled: true,
    cacheDir,
    concurrency: 3,
    rateLimit: 50,
    verbose: false,
    maxFunctionSize: 50_000,
    minFunctionSize: 5, // Process almost all functions
  };

  return {
    ...defaults,
    ...overrides,
    apiKey,
  };
}

/** Interactive cost confirmation for CLI */
export async function interactiveConfirmCost(
  estimate: CostEstimate,
): Promise<boolean> {
  console.log("\n" + formatCostEstimate(estimate));
  console.log("");

  // Use Bun's readline for interactive confirmation
  const response = await new Promise<string>((resolve) => {
    process.stdout.write("Proceed with de-minification? [y/N] ");

    // Set up stdin for reading
    process.stdin.setRawMode(false);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    const onData = (data: string) => {
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      resolve(data.trim().toLowerCase());
    };

    process.stdin.on("data", onData);
  });

  return response === "y" || response === "yes";
}

/** Format progress for CLI display */
export function formatProgress(progress: DeminifyProgress): string {
  const percent =
    progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0;

  const phases: Record<DeminifyProgress["phase"], string> = {
    parsing: "Parsing source",
    analyzing: "Analyzing functions",
    deminifying: "De-minifying",
    reassembling: "Reassembling",
  };

  let msg = `[${String(percent)}%] ${phases[progress.phase]}`;
  if (progress.currentItem) {
    msg += `: ${progress.currentItem}`;
  }

  return msg;
}

/** Format stats for display */
export function formatStats(stats: DeminifyStats): string {
  const lines: string[] = [];
  lines.push(`Functions processed: ${String(stats.functionsProcessed)}`);
  lines.push(`Cache hits: ${String(stats.cacheHits)}`);
  lines.push(`Cache misses: ${String(stats.cacheMisses)}`);
  lines.push(`Errors: ${String(stats.errors)}`);
  lines.push(`Input tokens: ${stats.inputTokensUsed.toLocaleString()}`);
  lines.push(`Output tokens: ${stats.outputTokensUsed.toLocaleString()}`);
  lines.push(
    `Average confidence: ${(stats.averageConfidence * 100).toFixed(1)}%`,
  );
  lines.push(`Time: ${(stats.timeTaken / 1000).toFixed(1)}s`);
  return lines.join("\n");
}
