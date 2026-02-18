/**
 * Batch processor for bottom-up de-minification.
 *
 * Key algorithm:
 * 1. Build call graph as a tree
 * 2. Process bottom-up (leaves first)
 * 3. After each round, apply renames to source
 * 4. Parent functions see renamed callees for better context
 *
 * Error handling strategy:
 * - LLM API errors: logged, empty mappings returned, processing continues
 * - Parse errors: logged, processing continues with other functions
 * - Cache errors: silently ignored, operation proceeds without caching
 * - Final rename errors: logged, original source returned
 *
 * @see Plan: /Users/jerred/.claude/plans/dazzling-popping-firefly.md
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  applyRenames,
  extractIdentifiers,
  type RenameMappings,
} from "./babel-renamer.ts";
import type { FunctionCache } from "./function-cache.ts";
import {
  getBatchSystemPrompt,
  getBatchFunctionPrompt,
  estimateBatchTokens,
  type BatchFunctionInfo,
} from "./prompt-templates.ts";
import { getTargetBatchTokens, getModelInfo } from "./tokenizer.ts";
import type {
  DeminifyConfig,
  ExtractedFunction,
  CallGraph,
  ExtendedProgress,
} from "./types.ts";

/** Result from API call with raw data */
type LLMCallResult = {
  mappings: RenameMappings;
  rawResponse: string;
  inputTokens: number;
  outputTokens: number;
  requestBody: unknown;
  responseBody: unknown;
};

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

/**
 * Batch processor for bottom-up de-minification.
 */
export class BatchProcessor {
  private readonly config: DeminifyConfig;
  private readonly cache: FunctionCache;
  private readonly openai: OpenAI | null = null;
  private readonly anthropic: Anthropic | null = null;
  private logFile: string | null = null;
  private requestCount = 0;

  // Stats
  private inputTokensUsed = 0;
  private outputTokensUsed = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private errors = 0;
  private startTime = 0;

  constructor(config: DeminifyConfig, cache: FunctionCache) {
    this.config = config;
    this.cache = cache;

    // Initialize the appropriate client
    if (config.provider === "openai") {
      this.openai = new OpenAI({ apiKey: config.apiKey });
    } else {
      this.anthropic = new Anthropic({ apiKey: config.apiKey });
    }
  }

  /**
   * Set log file path for raw request/response logging.
   */
  setLogFile(path: string): void {
    this.logFile = path;
  }

  /**
   * Log raw request/response to file.
   */
  private async logToFile(entry: {
    timestamp: string;
    type: "request" | "response";
    requestId: number;
    provider: string;
    model: string;
    systemPrompt?: string;
    userPrompt?: string;
    requestBody?: unknown;
    rawResponse?: string;
    responseBody?: unknown;
    parsedResponse?: RenameMappings;
    inputTokens?: number;
    outputTokens?: number;
    error?: string;
  }): Promise<void> {
    if (this.logFile == null || this.logFile.length === 0) {
      return;
    }

    try {
      const logDir = join(this.logFile, "..");
      await mkdir(logDir, { recursive: true });

      const separator = "\n" + "=".repeat(80) + "\n";
      const content = separator + JSON.stringify(entry, null, 2) + "\n";
      await appendFile(this.logFile, content);
    } catch (error) {
      console.error("Failed to write to log file:", error);
    }
  }

  /**
   * Process all functions in the call graph bottom-up.
   *
   * Strategy: Collect all rename mappings first, then apply once at the end.
   * This avoids position-shift issues where function IDs become invalid
   * after source modifications.
   *
   * @param source - The full source code
   * @param graph - The call graph
   * @param options - Processing options
   * @returns The de-minified source code
   */
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
        for (const [id, mapping] of Object.entries(mappings)) {
          allMappings[id] = mapping;

          // Track function name for context in subsequent rounds.
          // NOTE: knownNames contains "planned" renames, not "applied" renames.
          // The LLM sees what names we've *decided* on for earlier functions,
          // but the actual source modifications happen once at the end to avoid
          // position-shift bugs that would corrupt AST node positions.
          //
          // Trade-off: For circular dependencies, the LLM context is slightly
          // inconsistent (it sees planned names but reads original source), but
          // this prevents AST corruption which would be far worse.
          if (mapping.functionName != null && mapping.functionName.length > 0) {
            const fn = functions.find((f) => f.id === id);
            if (fn?.originalName != null && fn.originalName.length > 0) {
              knownNames.set(fn.originalName, mapping.functionName);
            }
          }
        }

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
            inputTokens: this.inputTokensUsed,
            outputTokens: this.outputTokensUsed,
            errors: this.errors,
            avgConfidence: 0.8, // Placeholder
            startTime: this.startTime,
            elapsed: Date.now() - this.startTime,
          });
        }
      }

      // NOTE: We do NOT apply renames between rounds anymore.
      // Instead, we pass knownNames to the LLM so it knows what we've renamed.
      // All renames are applied once at the end to avoid position shifts.
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

  /**
   * Sort functions by depth in call graph (leaves first).
   */
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
    return functions.sort((a, b) => {
      const depthA = depths.get(a.id) ?? 0;
      const depthB = depths.get(b.id) ?? 0;
      return depthA - depthB;
    });
  }

  /**
   * Get functions that are ready to process (all callees already processed).
   */
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

  /**
   * Create batches of functions that fit within token budget.
   * Uses accurate token counting via tiktoken/anthropic tokenizer.
   */
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

  /**
   * Add inline comments to function source showing relevant known renames.
   * This gives the LLM context about what the called functions do.
   *
   * Security note: We sanitize the annotation to prevent malicious source code
   * from injecting fake annotations. Only alphanumeric identifiers and arrows
   * are included in the comment.
   */
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
      // This prevents injection if source contains crafted strings
      if (!/^[a-z_$][\w$]*$/i.test(original)) {
        continue;
      }
      if (!/^[a-z_$][\w$]*$/i.test(renamed)) {
        continue;
      }

      // Check if this identifier is called in the source (as a function call)
      // Match patterns like: original(, original), original.
      const callPattern = new RegExp(String.raw`\b${original}\s*\(`);
      if (callPattern.test(source)) {
        relevantRenames.push(`${original}→${renamed}`);
      }
    }

    if (relevantRenames.length === 0) {
      return source;
    }

    // Add a comment header showing the relevant renames
    const comment = `// Calls: ${relevantRenames.join(", ")}`;
    return `${comment}\n${source}`;
  }

  /**
   * Process a batch of functions and get rename mappings.
   */
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
      const response = await this.callLLM(batchInfo, knownNames, verbose);
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

  /**
   * Call the LLM API to get rename mappings.
   */
  private async callLLM(
    functions: BatchFunctionInfo[],
    knownNames: Map<string, string>,
    verbose?: boolean,
  ): Promise<RenameMappings> {
    const systemPrompt = getBatchSystemPrompt();
    const userPrompt = getBatchFunctionPrompt(functions, knownNames);
    const requestId = ++this.requestCount;
    const timestamp = new Date().toISOString();

    if (verbose === true) {
      console.log("\n--- LLM Request ---");
      console.log(`Functions in batch: ${String(functions.length)}`);
      console.log(`Function IDs: ${functions.map((f) => f.id).join(", ")}`);
      console.log(`System prompt length: ${String(systemPrompt.length)} chars`);
      console.log(`User prompt length: ${String(userPrompt.length)} chars`);
      console.log("User prompt preview:");
      console.log(
        userPrompt.slice(0, 500) + (userPrompt.length > 500 ? "..." : ""),
      );
    }

    // Log request
    await this.logToFile({
      timestamp,
      type: "request",
      requestId,
      provider: this.config.provider,
      model: this.config.model,
      systemPrompt,
      userPrompt,
    });

    let result: RenameMappings;
    let llmResult: LLMCallResult;

    try {
      if (this.openai) {
        llmResult = await this.callOpenAIWithRaw(systemPrompt, userPrompt);
      } else if (this.anthropic) {
        llmResult = await this.callAnthropicWithRaw(systemPrompt, userPrompt);
      } else {
        throw new Error("No LLM client configured");
      }

      result = llmResult.mappings;

      // Log response with full request/response bodies
      await this.logToFile({
        timestamp: new Date().toISOString(),
        type: "response",
        requestId,
        provider: this.config.provider,
        model: this.config.model,
        requestBody: llmResult.requestBody,
        rawResponse: llmResult.rawResponse,
        responseBody: llmResult.responseBody,
        parsedResponse: result,
        inputTokens: llmResult.inputTokens,
        outputTokens: llmResult.outputTokens,
      });
    } catch (error) {
      // Log error
      await this.logToFile({
        timestamp: new Date().toISOString(),
        type: "response",
        requestId,
        provider: this.config.provider,
        model: this.config.model,
        error: String(error),
      });
      throw error;
    }

    if (verbose === true) {
      console.log("\n--- LLM Response ---");
      console.log(`Mappings received: ${String(Object.keys(result).length)}`);
      for (const [id, mapping] of Object.entries(result)) {
        const renameCount = Object.keys(mapping.renames).length;
        console.log(
          `  ${id}: ${mapping.functionName ?? "(no name)"} - ${String(renameCount)} renames`,
        );
        if (mapping.description != null && mapping.description.length > 0) {
          console.log(`    "${mapping.description}"`);
        }
      }
    }

    return result;
  }

  /**
   * Call OpenAI API with raw response capture.
   */
  private async callOpenAIWithRaw(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<LLMCallResult> {
    const requestBody = {
      model: this.config.model,
      max_completion_tokens: this.config.maxTokens,
      messages: [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: userPrompt },
      ],
      response_format: { type: "json_object" as const },
    };

    if (!this.openai) {
      throw new Error("OpenAI client not initialized");
    }

    const response = await this.openai.chat.completions.create(requestBody);

    // Track token usage
    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;
    this.inputTokensUsed += inputTokens;
    this.outputTokensUsed += outputTokens;

    const content = response.choices[0]?.message.content;
    if (content == null || content.length === 0) {
      throw new Error("Empty response from OpenAI");
    }

    return {
      mappings: this.parseResponse(content),
      rawResponse: content,
      inputTokens,
      outputTokens,
      requestBody,
      responseBody: response,
    };
  }

  /**
   * Call Anthropic API with raw response capture.
   */
  private async callAnthropicWithRaw(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<LLMCallResult> {
    const requestBody = {
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      system: systemPrompt,
      messages: [{ role: "user" as const, content: userPrompt }],
    };

    if (!this.anthropic) {
      throw new Error("Anthropic client not initialized");
    }

    const response = await this.anthropic.messages.create(requestBody);

    // Track token usage
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    this.inputTokensUsed += inputTokens;
    this.outputTokensUsed += outputTokens;

    const content = response.content[0];
    if (content?.type !== "text") {
      throw new Error("Unexpected response type from Anthropic");
    }

    return {
      mappings: this.parseResponse(content.text),
      rawResponse: content.text,
      inputTokens,
      outputTokens,
      requestBody,
      responseBody: response,
    };
  }

  /**
   * Parse LLM response into rename mappings.
   */
  private parseResponse(content: string): RenameMappings {
    // Try to extract JSON from the response
    let jsonStr = content.trim();

    // If wrapped in markdown code blocks, extract
    const jsonMatch = /```(?:json)?\n?([\s\S]*?)```/.exec(jsonStr);
    if (jsonMatch?.[1] != null && jsonMatch[1].length > 0) {
      jsonStr = jsonMatch[1].trim();
    }

    try {
      const raw = JSON.parse(jsonStr) as Record<string, unknown>;
      const parsed: RenameMappings = {};

      // Validate structure
      for (const [id, mapping] of Object.entries(raw)) {
        if (typeof mapping !== "object" || mapping === null) {
          continue;
        }

        const m = mapping as Record<string, unknown>;

        // Ensure renames is an object
        const renames =
          typeof m["renames"] === "object" && m["renames"] !== null
            ? (m["renames"] as Record<string, string>)
            : {};

        const entry: RenameMappings[string] = { renames };
        if (typeof m["functionName"] === "string") {
          entry.functionName = m["functionName"];
        }
        if (typeof m["description"] === "string") {
          entry.description = m["description"];
        }
        parsed[id] = entry;
      }

      return parsed;
    } catch {
      console.error(
        "Failed to parse LLM response as JSON:",
        content.slice(0, 200),
      );
      return {};
    }
  }

  /**
   * Get processing statistics.
   */
  getStats(): BatchResult {
    return {
      processed: this.cacheHits + this.cacheMisses,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      errors: this.errors,
      inputTokens: this.inputTokensUsed,
      outputTokens: this.outputTokensUsed,
    };
  }
}
