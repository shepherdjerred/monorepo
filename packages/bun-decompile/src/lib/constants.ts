/** Magic trailer at end of Bun executables */
export const BUN_TRAILER = "\n---- Bun! ----\n";
export const BUN_TRAILER_BYTES = new TextEncoder().encode(BUN_TRAILER);
export const BUN_TRAILER_LENGTH = 16;

/** Filesystem root markers */
export const BUNFS_ROOT = "/$bunfs/root";
export const BUNFS_ROOT_OLD = "compiled://root";

/** Version string markers (with ANSI escape codes) */
export const BUN_VERSION_MARKER = "bun build v";
export const BUN_VERSION_MARKER_OLD = "----- bun meta -----\nBun v";

/** Size of various structures */
export const OFFSETS_SIZE = 32; // Size of the Offsets structure (includes 4-byte padding)
export const STRING_POINTER_SIZE = 8; // u32 offset + u32 length
export const MODULE_ENTRY_SIZE = 36; // Size of CompiledModuleGraphFile

/** Loader type mapping from Bun's enum values */
export const LOADER_MAP: Record<number, string> = {
  0: "jsx",
  1: "js",
  2: "ts",
  3: "tsx",
  4: "css",
  5: "file",
  6: "json",
  7: "toml",
  8: "wasm",
  9: "napi",
  10: "text",
  11: "sqlite",
};

/** Encoding type mapping */
export const ENCODING_MAP: Record<number, string> = {
  0: "binary",
  1: "latin1",
  2: "utf8",
};

/** Module format mapping */
export const MODULE_FORMAT_MAP: Record<number, string> = {
  0: "none",
  1: "cjs",
  2: "esm",
};

/** File side mapping */
export const FILE_SIDE_MAP: Record<number, string> = {
  0: "server",
  1: "client",
};
