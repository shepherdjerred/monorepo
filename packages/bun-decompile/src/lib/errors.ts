/** Base error class for decompilation errors */
export class DecompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecompileError";
  }
}

/** File is not a valid Bun executable */
export class InvalidBinaryError extends DecompileError {
  constructor(reason: string) {
    super(`Invalid Bun binary: ${reason}`);
    this.name = "InvalidBinaryError";
  }
}

/** Missing or corrupt trailer */
export class InvalidTrailerError extends DecompileError {
  constructor() {
    super(
      "Missing or invalid Bun trailer. This file may not be a Bun-compiled executable.",
    );
    this.name = "InvalidTrailerError";
  }
}

/** Unsupported binary format version */
export class UnsupportedVersionError extends DecompileError {
  constructor(version?: string) {
    super(
      version
        ? `Unsupported Bun binary format version: ${version}`
        : "Unsupported or unrecognized Bun binary format",
    );
    this.name = "UnsupportedVersionError";
  }
}

/** Corrupt module graph data */
export class CorruptModuleGraphError extends DecompileError {
  constructor(reason: string) {
    super(`Corrupt module graph: ${reason}`);
    this.name = "CorruptModuleGraphError";
  }
}

/** File system error during extraction */
export class ExtractionError extends DecompileError {
  constructor(
    reason: string,
    public readonly path?: string,
  ) {
    super(
      path
        ? `Extraction failed for ${path}: ${reason}`
        : `Extraction failed: ${reason}`,
    );
    this.name = "ExtractionError";
  }
}
