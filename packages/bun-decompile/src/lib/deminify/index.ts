// Main exports
export {
  createConfig,
  deminify,
  Deminifier,
  formatProgress,
  formatStats,
  interactiveConfirmCost,
} from "./deminifier.ts";

export type { BatchStatusCallback, DeminifyFileOptions } from "./deminifier.ts";

// Types
export type {
  CacheEntry,
  CallGraph,
  CodeSegment,
  CostEstimate,
  DeminifyConfig,
  DeminifyContext,
  DeminifyProgress,
  DeminifyResult,
  DeminifyStats,
  ExportInfo,
  ExtendedProgress,
  ExtendedProgressCallback,
  ExtractedFunction,
  FileContext,
  FunctionContext,
  FunctionType,
  ImportInfo,
  ParameterInfo,
  ProgressCallback,
  Provider,
} from "./types.ts";

export { DEFAULT_CONFIG } from "./types.ts";

// Call graph utilities
export {
  buildCallGraph,
  getGraphStats,
  getProcessingOrder,
} from "./call-graph.ts";

// AST parser utilities
export { parseAndExtractFunctions, validateSource } from "./ast-parser.ts";

// LLM clients
export { ClaudeClient, formatCostEstimate } from "./claude-client.ts";
export { OpenAIClient } from "./openai-client.ts";

// Cache
export { DeminifyCache, hashSource, shouldCache } from "./cache.ts";

// Reassembler
export {
  createChangeSummary,
  formatOutput,
  getReassemblyStats,
  reassemble,
  verifyReassembly,
} from "./reassembler.ts";

// Progress display
export { createProgressCallback, ProgressDisplay } from "./progress-display.ts";

export type { ProgressDisplayOptions } from "./progress-display.ts";

// Batch API
export { BatchDeminifyClient, estimateBatchCost } from "./batch-client.ts";

export type { BatchStatus, BatchCallbacks } from "./batch-client.ts";

// Batch state
export {
  saveBatchState,
  loadBatchState,
  clearBatchState,
  formatBatchState,
} from "./batch-state.ts";

export type { BatchState } from "./batch-state.ts";
