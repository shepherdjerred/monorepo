import type { Node } from "acorn";

/** LLM provider for de-minification */
export type Provider = "anthropic" | "openai";

/** Type of function in the AST */
export type FunctionType =
  | "function-declaration"
  | "function-expression"
  | "arrow-function"
  | "method"
  | "constructor"
  | "getter"
  | "setter";

/** Information about a function parameter */
export type ParameterInfo = {
  /** Original parameter name */
  name: string;
  /** Whether parameter has a default value */
  hasDefault: boolean;
  /** Whether parameter is a rest parameter */
  isRest: boolean;
}

/** Represents a parsed function from the minified code */
export type ExtractedFunction = {
  /** Unique identifier (generated based on position) */
  id: string;
  /** Original minified name (may be single letter or empty) */
  originalName: string;
  /** Function node type */
  type: FunctionType;
  /** Start position in source (byte offset) */
  start: number;
  /** End position in source (byte offset) */
  end: number;
  /** Original minified source code */
  source: string;
  /** Function names this function calls */
  callees: string[];
  /** Function IDs that call this function (populated by call graph) */
  callers: string[];
  /** Parameters */
  params: ParameterInfo[];
  /** Whether function is async */
  isAsync: boolean;
  /** Whether function is a generator */
  isGenerator: boolean;
  /** Parent function ID (for nested functions) */
  parentId: string | null;
  /** Nested function IDs */
  children: string[];
  /** AST node reference */
  node: Node;
}

/** A segment of top-level code (not inside any function) */
export type CodeSegment = {
  /** Unique identifier */
  id: string;
  /** Start position in source */
  start: number;
  /** End position in source */
  end: number;
  /** Source code */
  source: string;
  /** Function names called in this segment */
  callees: string[];
}

/** Import statement info */
export type ImportInfo = {
  /** Module source path */
  source: string;
  /** Imported specifiers */
  specifiers: string[];
  /** Start position */
  start: number;
  /** End position */
  end: number;
}

/** Export statement info */
export type ExportInfo = {
  /** Exported name */
  name: string;
  /** Local name (if different) */
  localName: string;
  /** Start position */
  start: number;
  /** End position */
  end: number;
}

/** Call graph representing function relationships */
export type CallGraph = {
  /** All extracted functions by ID */
  functions: Map<string, ExtractedFunction>;
  /** Map from function name to function ID */
  nameToId: Map<string, string>;
  /** Top-level code segments (not in any function) */
  topLevelSegments: CodeSegment[];
  /** Module imports */
  imports: ImportInfo[];
  /** Module exports */
  exports: ExportInfo[];
  /** Original source code */
  source: string;
}

/** Context for a single function provided to Claude */
export type FunctionContext = {
  /** Function ID */
  id: string;
  /** Original minified source */
  originalSource: string;
  /** De-minified source (if already processed) */
  deminifiedSource: string | null;
  /** Suggested name (if already inferred) */
  suggestedName: string | null;
}

/** File-level context */
export type FileContext = {
  /** File name */
  fileName: string;
  /** Imports */
  imports: ImportInfo[];
  /** Exports */
  exports: ExportInfo[];
  /** Whether this is the entry point */
  isEntryPoint: boolean;
}

/** Full context provided to Claude for de-minification */
export type DeminifyContext = {
  /** The function to de-minify */
  targetFunction: ExtractedFunction;
  /** Functions that call this function */
  callers: FunctionContext[];
  /** Functions this function calls */
  callees: FunctionContext[];
  /** Known variable/function name mappings */
  knownNames: Map<string, string>;
  /** File-level context */
  fileContext: FileContext;
}

/** Result of de-minifying a single function */
export type DeminifyResult = {
  /** Function ID */
  functionId: string;
  /** Original minified source */
  originalSource: string;
  /** De-minified source */
  deminifiedSource: string;
  /** Suggested descriptive name for the function */
  suggestedName: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Parameter name mappings (original -> suggested) */
  parameterNames: Record<string, string>;
  /** Local variable name mappings (original -> suggested) */
  localVariableNames: Record<string, string>;
}

/** Configuration for de-minification */
export type DeminifyConfig = {
  /** LLM provider */
  provider: Provider;
  /** API key for the provider */
  apiKey: string;
  /** Model to use */
  model: string;
  /** Maximum tokens per response */
  maxTokens: number;
  /** Enable caching */
  cacheEnabled: boolean;
  /** Cache directory */
  cacheDir: string;
  /** Parallel request limit */
  concurrency: number;
  /** Rate limit (requests per minute) */
  rateLimit: number;
  /** Verbose logging */
  verbose: boolean;
  /** Max function size to process (characters) */
  maxFunctionSize: number;
  /** Min function size to process (skip trivial functions) */
  minFunctionSize: number;
}

/** Default configuration values (cacheDir must be provided based on output path) */
export const DEFAULT_CONFIG: Omit<DeminifyConfig, "apiKey" | "cacheDir"> = {
  provider: "openai",
  model: "gpt-5-nano",
  maxTokens: 16384, // GPT-5 nano uses reasoning tokens, needs more headroom
  cacheEnabled: true,
  concurrency: 3,
  rateLimit: 50,
  verbose: false,
  maxFunctionSize: 50000,
  minFunctionSize: 5, // Process almost all functions
};

/** Progress callback for long operations */
export type ProgressCallback = (progress: DeminifyProgress) => void;

/** Extended progress callback with live stats */
export type ExtendedProgressCallback = (progress: ExtendedProgress) => void;

/** Progress information */
export type DeminifyProgress = {
  /** Current phase */
  phase: "parsing" | "analyzing" | "deminifying" | "reassembling";
  /** Current item index */
  current: number;
  /** Total items */
  total: number;
  /** Current item name (if applicable) */
  currentItem?: string;
}

/** Extended progress with live statistics */
export type ExtendedProgress = {
  /** Cache hits so far */
  cacheHits: number;
  /** Cache misses so far */
  cacheMisses: number;
  /** Input tokens used so far */
  inputTokens: number;
  /** Output tokens used so far */
  outputTokens: number;
  /** Errors encountered so far */
  errors: number;
  /** Average confidence score so far */
  avgConfidence: number;
  /** Start time (timestamp) */
  startTime: number;
  /** Elapsed time in milliseconds */
  elapsed: number;
} & DeminifyProgress

/** Cost estimate for de-minification */
export type CostEstimate = {
  /** Estimated input tokens */
  inputTokens: number;
  /** Estimated output tokens */
  outputTokens: number;
  /** Estimated cost in USD */
  estimatedCost: number;
  /** Number of functions to process */
  functionCount: number;
  /** Number of API requests */
  requestCount: number;
}

/** Cache entry */
export type CacheEntry = {
  /** Hash of function source */
  hash: string;
  /** De-minification result */
  result: DeminifyResult;
  /** Timestamp when cached */
  timestamp: number;
  /** Model version used */
  modelVersion: string;
}

/** Statistics from de-minification run */
export type DeminifyStats = {
  /** Functions processed */
  functionsProcessed: number;
  /** Total input tokens used */
  inputTokensUsed: number;
  /** Total output tokens used */
  outputTokensUsed: number;
  /** Cache hits */
  cacheHits: number;
  /** Cache misses */
  cacheMisses: number;
  /** Errors encountered */
  errors: number;
  /** Average confidence score */
  averageConfidence: number;
  /** Time taken in milliseconds */
  timeTaken: number;
}
