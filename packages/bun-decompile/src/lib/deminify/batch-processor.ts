/** Batch processor for bottom-up de-minification (leaves first, Babel rename). */

import {
  applyRenames,
  extractIdentifiers,
  type RenameMappings,
} from "./babel-renamer.ts";
import type { FunctionCache } from "./function-cache.ts";
import { estimateBatchTokens, type BatchFunctionInfo } from "./prompt-templates.ts";
import { getTargetBatchTokens, getModelInfo } from "./tokenizer.ts";
import type {
  DeminifyConfig,
  ExtractedFunction,
  CallGraph,
  ExtendedProgress,
} from "./types.ts";
import { LLMCaller } from "./llm-caller.ts";

/** Result from processing a batch */
export type BatchResult = {
  /** Functions processed */
  processed: number;
  /** Cache hits */
  cacheHits: number;
  /** Cache misses (API calls made) */
  cacheMisses: number;
  /** Errors encountered */
  errors: number;
  /** Input tokens used */
  inputTokens: number;
  /** Output tokens used */
  outputTokens: number;
};

/** Options for batch processing */
export type BatchProcessorOptions = {
  /**
   * Maximum tokens per batch.
   * If not specified, automatically computed from model's context limit (90% utilization).
   */
  maxBatchTokens?: number;
  /** Progress callback */
  onProgress?: (progress: ExtendedProgress) => void;
  /** Verbose logging */
  verbose?: boolean;
};

export class BatchProcessor {
  private readonly config: DeminifyConfig;
  private readonly cache: FunctionCache;
  private readonly llmCaller: LLMCaller;

  // Stats
  private cacheHits = 0;
  private cacheMisses = 0;
  private errors = 0;
  private startTime = 0;

  constructor(config: DeminifyConfig, cache: FunctionCache) {
    this.config = config;
    this.cache = cache;
    this.llmCaller = new LLMCaller(config);
  }

  setLogFile(logPath: string): void {
    this.llmCaller.setLogFile(logPath);
  }

  /** Process all functions bottom-up, collecting rename mappings and applying once at end. */
  async processAll(
    source: string,
    graph: CallGraph,
    options: BatchProcessorOptions = {},
  ): Promise<string> {
    const { onProgress, verbose } = options;

    // Compute token budget from model's context limit if not explicitly specified.
    // Uses tiktoken/anthropic tokenizer for accurate counting, so no safety margin needed.
    const modelInfo = getModelInfo(this.config.model);
    const maxBatchTokens =
      options.maxBatchTokens ?? getTargetBatchTokens(this.config.model);

    if (verbose === true) {
      console.log(
        `Model: ${this.config.model} | Context: ${modelInfo.contextLimit.toLocaleString()} | Batch budget: ${maxBatchTokens.toLocaleString()} tokens`,
      );
    }

    this.startTime = Date.now();

    // Get all functions sorted by depth (leaves first)
    const functions = this.sortByDepth(graph);
    const totalFunctions = functions.length;

    if (verbose === true) {
      console.log(
        `Processing ${String(totalFunctions)} functions bottom-up...`,
      );
    }

    // Track which functions have been processed
    const processed = new Set<string>();
    // Track all rename mappings (collected across all rounds, applied once at end)
    const allMappings: RenameMappings = {};
    // Track known names for context (so later rounds see what earlier rounds renamed)
    const knownNames = new Map<string, string>();

    let round = 0;

    while (processed.size < totalFunctions) {
      round++;

      // Get functions ready to process (all callees already done)
      const ready = this.getReadyFunctions(functions, graph, processed);

      if (ready.length === 0) {
        // Handle circular dependencies - just process remaining functions
        const remaining = functions.filter((f) => !processed.has(f.id));
        if (remaining.length > 0) {
          ready.push(...remaining);
        } else {
          break;
        }
      }

      if (verbose === true) {
        console.log(
          `Round ${String(round)}: ${String(ready.length)} functions ready`,
        );
      }

      // Create batches using ORIGINAL source (positions don't change)
      const batches = this.createBatches(ready, maxBatchTokens, source);

      if (verbose === true) {
        console.log(`  Split into ${String(batches.length)} batches`);
      }

      // Process each batch
      for (const batch of batches) {
        const mappings = await this.processBatch(batch, knownNames, verbose);

        // Merge mappings
        this.mergeMappings(mappings, allMappings, knownNames, functions);

        // Mark as processed
        for (const fn of batch) {
          processed.add(fn.id);
        }

        // Report progress
        if (onProgress) {
          onProgress({
            phase: "deminifying",
            current: processed.size,
            total: totalFunctions,
            currentItem: batch[0]?.originalName ?? "batch",
            cacheHits: this.cacheHits,
            cacheMisses: this.cacheMisses,
            inputTokens: this.llmCaller.inputTokensUsed,
            outputTokens: this.llmCaller.outputTokensUsed,
            errors: this.errors,
            avgConfidence: 0.8, // Placeholder
            startTime: this.startTime,
            elapsed: Date.now() - this.startTime,
          });
        }
      }
    }

    // Apply ALL renames at once to the original source
    if (verbose === true) {
      console.log(
        `Applying ${String(Object.keys(allMappings).length)} rename mappings...`,
      );
    }

    try {
      return applyRenames(source, allMappings);
    } catch (error) {
      if (verbose === true) {
        console.error("Error applying renames:", error);
      }
      this.errors++;
      return source; // Return original on error
    }
  }

  /** Merge batch mappings into the accumulated mappings and known names */
  private mergeMappings(
    batchMappings: RenameMappings,
    allMappings: RenameMappings,
    knownNames: Map<string, string>,
    functions: ExtractedFunction[],
  ): void {
    for (const [id, mapping] of Object.entries(batchMappings)) {
      allMappings[id] = mapping;

      // Track function name for context in subsequent rounds.
      if (mapping.functionName != null && mapping.functionName.length > 0) {
        const fn = functions.find((f) => f.id === id);
        if (fn?.originalName != null && fn.originalName.length > 0) {
          knownNames.set(fn.originalName, mapping.functionName);
        }
      }
    }
  }

  private sortByDepth(graph: CallGraph): ExtractedFunction[] {
    const functions = [...graph.functions.values()];
    const depths = new Map<string, number>();

    // Calculate depth for each function (max depth of callees + 1)
    const getDepth = (id: string, visited: Set<string>): number => {
      if (depths.has(id)) {
        return depths.get(id) ?? 0;
      }
      if (visited.has(id)) {
        return 0;
      } // Circular dependency

      visited.add(id);

      const fn = graph.functions.get(id);
      if (!fn || fn.callees.length === 0) {
        depths.set(id, 0);
        return 0;
      }

      let maxCalleeDepth = 0;
      for (const calleeName of fn.callees) {
        const calleeId = graph.nameToId.get(calleeName);
        if (calleeId != null && calleeId.length > 0 && calleeId !== id) {
          maxCalleeDepth = Math.max(
            maxCalleeDepth,
            getDepth(calleeId, visited) + 1,
          );
        }
      }

      depths.set(id, maxCalleeDepth);
      return maxCalleeDepth;
    };

    // Calculate all depths
    for (const fn of functions) {
      getDepth(fn.id, new Set());
    }

    // Sort by depth (ascending = leaves first)
    return functions.toSorted((a, b) => {
      const depthA = depths.get(a.id) ?? 0;
      const depthB = depths.get(b.id) ?? 0;
      return depthA - depthB;
    });
  }

  private getReadyFunctions(
    functions: ExtractedFunction[],
    graph: CallGraph,
    processed: Set<string>,
  ): ExtractedFunction[] {
    return functions.filter((fn) => {
      if (processed.has(fn.id)) {
        return false;
      }

      // Check if all callees are processed
      for (const calleeName of fn.callees) {
        const calleeId = graph.nameToId.get(calleeName);
        if (
          calleeId != null &&
          calleeId.length > 0 &&
          !processed.has(calleeId)
        ) {
          return false;
        }
      }

      return true;
    });
  }

  private createBatches(
    functions: ExtractedFunction[],
    maxTokens: number,
    currentSource: string,
  ): ExtractedFunction[][] {
    const batches: ExtractedFunction[][] = [];
    let currentBatch: ExtractedFunction[] = [];
    let currentTokens = 0;

    for (const fn of functions) {
      // Get current source for this function from the source
      const funcSource = currentSource.slice(fn.start, fn.end);
      const funcInfo: BatchFunctionInfo = {
        id: fn.id,
        source: funcSource,
        identifiers: extractIdentifiers(funcSource),
      };

      // Use accurate token counting with model-specific tokenizer
      const funcTokens = estimateBatchTokens([funcInfo], this.config.model);

      // If this single function exceeds budget, process it alone
      if (funcTokens > maxTokens) {
        if (currentBatch.length > 0) {
          batches.push(currentBatch);
          currentBatch = [];
          currentTokens = 0;
        }
        batches.push([fn]);
        continue;
      }

      // If adding this function exceeds budget, start new batch
      if (currentTokens + funcTokens > maxTokens) {
        batches.push(currentBatch);
        currentBatch = [fn];
        currentTokens = funcTokens;
      } else {
        currentBatch.push(fn);
        currentTokens += funcTokens;
      }
    }

    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    return batches;
  }

  /** Add inline comments showing relevant known renames for LLM context. */
  private annotateWithKnownNames(
    source: string,
    knownNames: Map<string, string>,
  ): string {
    if (knownNames.size === 0) {
      return source;
    }

    // Find which known names appear in this function's source
    const relevantRenames: string[] = [];
    for (const [original, renamed] of knownNames) {
      // Validate that original and renamed are safe identifiers (alphanumeric + underscore)
      if (!/^[a-z_$][\w$]*$/i.test(original)) {
        continue;
      }
      if (!/^[a-z_$][\w$]*$/i.test(renamed)) {
        continue;
      }

      // Check if this identifier is called in the source (as a function call)
      const callPattern = new RegExp(String.raw`\b${original}\s*\(`);
      if (callPattern.test(source)) {
        relevantRenames.push(`${original}\u2192${renamed}`);
      }
    }

    if (relevantRenames.length === 0) {
      return source;
    }

    // Add a comment header showing the relevant renames
    const comment = `// Calls: ${relevantRenames.join(", ")}`;
    return `${comment}\n${source}`;
  }

  private async processBatch(
    functions: ExtractedFunction[],
    knownNames: Map<string, string>,
    verbose?: boolean,
  ): Promise<RenameMappings> {
    const mappings: RenameMappings = {};

    // Check cache for each function
    const uncached: ExtractedFunction[] = [];

    for (const fn of functions) {
      const hash = this.cache.hashFunction(fn.source);
      const cached = await this.cache.get(hash);

      if (cached) {
        mappings[fn.id] = cached.mapping;
        this.cacheHits++;
      } else {
        uncached.push(fn);
      }
    }

    if (uncached.length === 0) {
      return mappings;
    }

    // Prepare batch info for API call, annotating with known names
    const batchInfo: BatchFunctionInfo[] = uncached.map((fn) => ({
      id: fn.id,
      // Add inline comments showing relevant known renames for context
      source: this.annotateWithKnownNames(fn.source, knownNames),
      identifiers: extractIdentifiers(fn.source),
    }));

    // Call LLM
    try {
      const response = await this.llmCaller.callLLM(
        batchInfo,
        knownNames,
        verbose,
      );
      this.cacheMisses += uncached.length;

      // Parse response and cache results
      for (const fn of uncached) {
        const mapping = response[fn.id];
        if (mapping) {
          mappings[fn.id] = mapping;

          // Cache the result
          const hash = this.cache.hashFunction(fn.source);
          await this.cache.set(hash, mapping);
        } else {
          // No mapping returned - use empty mapping
          mappings[fn.id] = { renames: {} };
        }
      }
    } catch (error) {
      if (verbose === true) {
        console.error("Error calling LLM:", error);
      }
      this.errors++;

      // Return empty mappings for failed functions
      for (const fn of uncached) {
        mappings[fn.id] = { renames: {} };
      }
    }

    return mappings;
  }

  getStats(): BatchResult {
    return {
      processed: this.cacheHits + this.cacheMisses,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      errors: this.errors,
      inputTokens: this.llmCaller.inputTokensUsed,
      outputTokens: this.llmCaller.outputTokensUsed,
    };
  }
}
