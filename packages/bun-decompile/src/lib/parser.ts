import {
  BUN_TRAILER_BYTES,
  BUN_TRAILER_LENGTH,
  BUN_VERSION_MARKER,
  BUN_VERSION_MARKER_OLD,
  BUNFS_ROOT,
  BUNFS_ROOT_OLD,
  ENCODING_MAP,
  FILE_SIDE_MAP,
  LOADER_MAP,
  MODULE_ENTRY_SIZE,
  MODULE_FORMAT_MAP,
  OFFSETS_SIZE,
} from "./constants.ts";
import {
  CorruptModuleGraphError,
  InvalidBinaryError,
  InvalidTrailerError,
} from "./errors.ts";
import { parseSourceMap } from "./sourcemap-parser.ts";
import type {
  DecompileResult,
  Encoding,
  FileSide,
  Loader,
  ModuleEntry,
  ModuleFormat,
  Offsets,
  OriginalSource,
  StringPointer,
} from "./types.ts";

/** Find the trailer position by searching backwards from the end */
function findTrailerPosition(buffer: Uint8Array): number {
  // On macOS Mach-O binaries, there may be significant padding after the trailer
  // Search backwards from the end to find it (up to 4MB for large binaries)
  const searchLimit = Math.min(buffer.length, 4 * 1024 * 1024); // Search last 4MB max

  for (
    let pos = buffer.length - BUN_TRAILER_LENGTH;
    pos >= buffer.length - searchLimit;
    pos--
  ) {
    let matches = true;
    for (let i = 0; i < BUN_TRAILER_LENGTH; i++) {
      if (buffer[pos + i] !== BUN_TRAILER_BYTES[i]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return pos;
    }
  }
  return -1;
}

/** Read a 32-bit unsigned integer (little-endian) */
function readU32(buffer: Uint8Array, offset: number): number {
  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  );
  return view.getUint32(offset, true);
}

/** Read a StringPointer from the buffer */
function readStringPointer(buffer: Uint8Array, offset: number): StringPointer {
  return {
    offset: readU32(buffer, offset),
    length: readU32(buffer, offset + 4),
  };
}

/** Extract bytes using a StringPointer */
function extractBytes(
  buffer: Uint8Array,
  dataStart: number,
  ptr: StringPointer,
): Uint8Array {
  if (ptr.length === 0) {
    return new Uint8Array(0);
  }
  const start = dataStart + ptr.offset;
  const end = start + ptr.length;
  if (end > buffer.length) {
    throw new CorruptModuleGraphError(
      `Pointer extends beyond buffer: offset=${String(ptr.offset)}, length=${String(ptr.length)}`,
    );
  }
  return buffer.slice(start, end);
}

/** Extract a string using a StringPointer */
function extractString(
  buffer: Uint8Array,
  dataStart: number,
  ptr: StringPointer,
): string {
  const bytes = extractBytes(buffer, dataStart, ptr);
  return new TextDecoder().decode(bytes);
}

/** Read the Offsets structure from just before the trailer */
function readOffsets(buffer: Uint8Array, trailerPos: number): Offsets {
  // Offsets are stored just before the trailer
  // Structure (32 bytes):
  //   byteCount: u32 (4 bytes) at offset 0
  //   padding: u32 (4 bytes) at offset 4
  //   modulesPtr: StringPointer (8 bytes) at offset 8
  //   entryPointId: u32 (4 bytes) at offset 16
  //   argsPtr: StringPointer (8 bytes) at offset 20
  //   flags: u32 (4 bytes) at offset 28
  const offsetsStart = trailerPos - OFFSETS_SIZE;

  if (offsetsStart < 0) {
    throw new InvalidBinaryError("File too small to contain offsets structure");
  }

  return {
    byteCount: readU32(buffer, offsetsStart),
    modulesPtr: readStringPointer(buffer, offsetsStart + 8),
    entryPointId: readU32(buffer, offsetsStart + 16),
    argsPtr: readStringPointer(buffer, offsetsStart + 20),
    flags: readU32(buffer, offsetsStart + 28),
  };
}

/** Normalize a module path by removing the bunfs root prefix */
function normalizePath(path: string): string {
  if (path.startsWith(BUNFS_ROOT)) {
    return path.slice(BUNFS_ROOT.length);
  }
  if (path.startsWith(BUNFS_ROOT_OLD)) {
    return path.slice(BUNFS_ROOT_OLD.length);
  }
  return path;
}

/** Try to find the Bun version string in the binary */
function findBunVersion(buffer: Uint8Array): string | null {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);

  // Try modern format first
  let idx = text.indexOf(BUN_VERSION_MARKER);
  if (idx !== -1) {
    const start = idx + BUN_VERSION_MARKER.length;
    const end = text.indexOf("\n", start);
    if (end !== -1 && end - start < 20) {
      return text.slice(start, end).trim();
    }
  }

  // Try legacy format
  idx = text.indexOf(BUN_VERSION_MARKER_OLD);
  if (idx !== -1) {
    const start = idx + BUN_VERSION_MARKER_OLD.length;
    const end = text.indexOf("\n", start);
    if (end !== -1 && end - start < 20) {
      return text.slice(start, end).trim();
    }
  }

  return null;
}

/** Parse the module graph from the embedded data */
function parseModules(
  buffer: Uint8Array,
  dataStart: number,
  offsets: Offsets,
): ModuleEntry[] {
  const modules: ModuleEntry[] = [];

  // Calculate where the module entries start
  const modulesStart = dataStart + offsets.modulesPtr.offset;
  const moduleCount = Math.floor(offsets.modulesPtr.length / MODULE_ENTRY_SIZE);

  if (moduleCount === 0) {
    throw new CorruptModuleGraphError("No modules found in binary");
  }

  for (let i = 0; i < moduleCount; i++) {
    const entryOffset = modulesStart + i * MODULE_ENTRY_SIZE;

    // Read module entry fields
    const namePtr = readStringPointer(buffer, entryOffset);
    const contentsPtr = readStringPointer(buffer, entryOffset + 8);
    const sourcemapPtr = readStringPointer(buffer, entryOffset + 16);
    const bytecodePtr = readStringPointer(buffer, entryOffset + 24);

    // Read metadata bytes (with bounds checking for strict TS)
    const encodingByte = buffer[entryOffset + 32] ?? 0;
    const loaderByte = buffer[entryOffset + 33] ?? 0;
    const moduleFormatByte = buffer[entryOffset + 34] ?? 0;
    const sideByte = buffer[entryOffset + 35] ?? 0;

    // Extract content
    const rawName = extractString(buffer, dataStart, namePtr);
    const name = normalizePath(rawName);
    const contents = extractBytes(buffer, dataStart, contentsPtr);
    const sourcemap =
      sourcemapPtr.length > 0
        ? extractBytes(buffer, dataStart, sourcemapPtr)
        : null;
    const bytecode =
      bytecodePtr.length > 0
        ? extractBytes(buffer, dataStart, bytecodePtr)
        : null;

    // Map enum values
    const encoding = (ENCODING_MAP[encodingByte] ?? "binary") as Encoding;
    const loader = (LOADER_MAP[loaderByte] ?? "unknown") as Loader;
    const moduleFormat = (MODULE_FORMAT_MAP[moduleFormatByte] ??
      "none") as ModuleFormat;
    const side = (FILE_SIDE_MAP[sideByte] ?? "server") as FileSide;

    modules.push({
      name,
      contents,
      sourcemap,
      bytecode,
      encoding,
      loader,
      moduleFormat,
      side,
      isEntryPoint: i === offsets.entryPointId,
    });
  }

  return modules;
}

/** Parse compile-time arguments */
function parseArgs(
  buffer: Uint8Array,
  dataStart: number,
  offsets: Offsets,
): string[] {
  if (offsets.argsPtr.length === 0) {
    return [];
  }

  const argsString = extractString(buffer, dataStart, offsets.argsPtr);
  // Args are null-separated
  return argsString.split("\0").filter((arg) => arg.length > 0);
}

/** Extract original sources from module sourcemaps */
async function extractOriginalSources(
  modules: ModuleEntry[],
): Promise<OriginalSource[]> {
  const originalSources: OriginalSource[] = [];

  for (const module of modules) {
    if (module.sourcemap && module.sourcemap.length > 0) {
      const parsed = await parseSourceMap(module.sourcemap);
      if (parsed) {
        for (const source of parsed.sources) {
          originalSources.push({
            name: source.name,
            content: source.content,
          });
        }
      }
    }
  }

  return originalSources;
}

/** Decompile a Bun binary and extract all embedded modules */
export async function decompile(buffer: Uint8Array): Promise<DecompileResult> {
  // Find the trailer (may not be at absolute end on macOS due to Mach-O padding)
  const trailerPos = findTrailerPosition(buffer);
  if (trailerPos < 0) {
    throw new InvalidTrailerError();
  }

  // Read the offsets structure (just before the trailer)
  const offsets = readOffsets(buffer, trailerPos);

  // Validate byte count
  if (offsets.byteCount <= 0) {
    throw new CorruptModuleGraphError("Invalid byte count in offsets");
  }

  // Calculate where the embedded data starts
  // Data is stored at: trailerPos - offsets - byteCount
  const dataStart = trailerPos - OFFSETS_SIZE - offsets.byteCount;

  if (dataStart < 0) {
    throw new CorruptModuleGraphError(
      "Calculated data start is negative - corrupt binary or wrong format",
    );
  }

  // Find Bun version
  const bunVersion = findBunVersion(buffer);

  // Parse modules
  const modules = parseModules(buffer, dataStart, offsets);

  // Parse args
  const args = parseArgs(buffer, dataStart, offsets);

  // Extract original sources from sourcemaps
  const originalSources = await extractOriginalSources(modules);

  return {
    bunVersion,
    modules,
    originalSources,
    args,
    flags: offsets.flags,
  };
}

/** Decompile from a file path */
export async function decompileFile(
  filePath: string,
): Promise<DecompileResult> {
  const file = Bun.file(filePath);
  const buffer = new Uint8Array(await file.arrayBuffer());
  return decompile(buffer);
}
