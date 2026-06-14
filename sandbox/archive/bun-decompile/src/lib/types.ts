/** Pointer to a string/buffer within the embedded data */
export type StringPointer = {
  offset: number;
  length: number;
};

/** Encoding type for module contents */
export type Encoding = "binary" | "latin1" | "utf8";

/** Module format (ES modules or CommonJS) */
export type ModuleFormat = "esm" | "cjs" | "none";

/** File loader type */
export type Loader =
  | "jsx"
  | "js"
  | "ts"
  | "tsx"
  | "css"
  | "file"
  | "json"
  | "toml"
  | "wasm"
  | "napi"
  | "text"
  | "sqlite"
  | "unknown";

/** Server or client side */
export type FileSide = "server" | "client";

/** Offsets structure stored at end of binary before trailer */
export type Offsets = {
  /** Total size of embedded data */
  byteCount: number;
  /** Pointer to the modules array */
  modulesPtr: StringPointer;
  /** Index of the entry point module */
  entryPointId: number;
  /** Pointer to compile-time argv */
  argsPtr: StringPointer;
  /** Configuration flags */
  flags: number;
};

/** A single extracted module */
export type ModuleEntry = {
  /** Original file path */
  name: string;
  /** Transpiled source code */
  contents: Uint8Array;
  /** Source map if available */
  sourcemap: Uint8Array | null;
  /** Pre-compiled bytecode if available */
  bytecode: Uint8Array | null;
  /** Content encoding */
  encoding: Encoding;
  /** File loader type */
  loader: Loader;
  /** Module format */
  moduleFormat: ModuleFormat;
  /** Server or client side */
  side: FileSide;
  /** Whether this is the entry point */
  isEntryPoint: boolean;
};

/** Original source file extracted from sourcemap */
export type OriginalSource = {
  /** Original file name (e.g., "utils.ts") */
  name: string;
  /** Original source content with types/comments */
  content: string;
};

/** Result of decompiling a Bun binary */
export type DecompileResult = {
  /** Bun version that compiled this binary */
  bunVersion: string | null;
  /** All extracted modules (bundled/transpiled) */
  modules: ModuleEntry[];
  /** Original source files from sourcemap (if available) */
  originalSources: OriginalSource[];
  /** Compile-time arguments */
  args: string[];
  /** Raw flags value */
  flags: number;
};

/** Metadata written to metadata.json */
export type DecompileMetadata = {
  bunVersion: string | null;
  entryPoint: string;
  args: string[];
  flags: number;
  moduleCount: number;
  originalSourceCount: number;
  hasOriginalSources: boolean;
  extractedAt: string;
};
