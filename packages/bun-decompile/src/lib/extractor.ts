import { mkdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { ExtractionError } from "./errors.ts";
import type {
  DecompileMetadata,
  DecompileResult,
  ModuleEntry,
  OriginalSource,
} from "./types.ts";

/** Get the file extension for a source file based on loader */
function getSourceExtension(module: ModuleEntry): string {
  switch (module.loader) {
    case "ts":
      return ".ts";
    case "tsx":
      return ".tsx";
    case "jsx":
      return ".jsx";
    case "css":
      return ".css";
    case "json":
      return ".json";
    case "toml":
      return ".toml";
    case "text":
      return ".txt";
    default:
      return ".js";
  }
}

/** Ensure the output path is safe (no path traversal) */
function sanitizePath(basePath: string, relativePath: string): string {
  // Remove leading slashes and normalize
  const normalized = relativePath.replace(/^\/+/, "").replace(/\\/g, "/");

  // Check for path traversal
  if (normalized.includes("..")) {
    throw new ExtractionError("Path traversal detected", relativePath);
  }

  return join(basePath, normalized);
}

/** Write a single file, creating directories as needed */
async function writeFile(filePath: string, contents: Uint8Array): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
  await Bun.write(filePath, contents);
}

/** Decode module contents based on encoding */
function decodeContents(module: ModuleEntry): string | Uint8Array {
  if (module.encoding === "binary") {
    return module.contents;
  }

  // For text encodings, just decode as UTF-8 (works for most JS sources)
  const decoder = new TextDecoder("utf-8");
  return decoder.decode(module.contents);
}

/** Normalize a source file name, handling paths with .. */
function normalizeSourceName(name: string): string {
  // If the path contains .., just use the basename
  if (name.includes("..")) {
    return basename(name);
  }
  // Remove leading slashes
  return name.replace(/^\/+/, "");
}

/** Write original source files to a directory */
async function writeOriginalSources(
  sources: OriginalSource[],
  outputDir: string,
): Promise<void> {
  for (const source of sources) {
    const normalizedName = normalizeSourceName(source.name);
    const filePath = sanitizePath(outputDir, normalizedName);
    await writeFile(filePath, new TextEncoder().encode(source.content));
  }
}

/** Extract all modules to a directory */
export async function extractToDirectory(
  result: DecompileResult,
  outputDir: string,
): Promise<void> {
  const bundledDir = join(outputDir, "bundled");
  const originalDir = join(outputDir, "original");
  const bytecodeDir = join(outputDir, "bytecode");

  // Find entry point
  const entryPoint = result.modules.find((m) => m.isEntryPoint);
  const entryPointName = entryPoint?.name ?? "unknown";

  const hasOriginalSources = result.originalSources.length > 0;

  // Write metadata
  const metadata: DecompileMetadata = {
    bunVersion: result.bunVersion,
    entryPoint: entryPointName,
    args: result.args,
    flags: result.flags,
    moduleCount: result.modules.length,
    originalSourceCount: result.originalSources.length,
    hasOriginalSources,
    extractedAt: new Date().toISOString(),
  };

  await mkdir(outputDir, { recursive: true });
  await Bun.write(
    join(outputDir, "metadata.json"),
    JSON.stringify(metadata, null, 2),
  );

  // Write original sources if available (preferred)
  if (hasOriginalSources) {
    await writeOriginalSources(result.originalSources, originalDir);
  }

  // Always write bundled/transpiled sources too
  for (const module of result.modules) {
    // Skip empty modules
    if (module.contents.length === 0 && !module.bytecode && !module.sourcemap) {
      continue;
    }

    // Determine output filename
    let filename = module.name;
    if (!filename || filename === "/") {
      filename = module.isEntryPoint ? "index" : `module_${result.modules.indexOf(module)}`;
    }

    // Add extension if missing
    if (!filename.includes(".")) {
      filename += getSourceExtension(module);
    }

    // Write bundled source file
    if (module.contents.length > 0) {
      const srcPath = sanitizePath(bundledDir, filename);
      const contents = decodeContents(module);
      if (typeof contents === "string") {
        await writeFile(srcPath, new TextEncoder().encode(contents));
      } else {
        await writeFile(srcPath, contents);
      }
    }

    // Write sourcemap if present
    if (module.sourcemap && module.sourcemap.length > 0) {
      const mapPath = sanitizePath(bundledDir, filename + ".map");
      await writeFile(mapPath, module.sourcemap);
    }

    // Write bytecode if present
    if (module.bytecode && module.bytecode.length > 0) {
      // Change extension to .jsc for bytecode
      const bytecodeFilename = filename.replace(/\.[^.]+$/, ".jsc");
      const bytecodePath = sanitizePath(bytecodeDir, bytecodeFilename);
      await writeFile(bytecodePath, module.bytecode);
    }
  }
}

/** Get a summary of what will be extracted */
export function getExtractionSummary(result: DecompileResult): string {
  const lines: string[] = [];

  lines.push(`Bun Version: ${result.bunVersion ?? "unknown"}`);
  lines.push(`Bundled Modules: ${result.modules.length}`);

  const entryPoint = result.modules.find((m) => m.isEntryPoint);
  if (entryPoint) {
    lines.push(`Entry Point: ${entryPoint.name}`);
  }

  // Original sources from sourcemaps
  if (result.originalSources.length > 0) {
    lines.push(`Original Sources: ${result.originalSources.length} (recovered from sourcemap)`);
    for (const source of result.originalSources) {
      lines.push(`  - ${source.name}`);
    }
  }

  const withSourcemaps = result.modules.filter(
    (m) => m.sourcemap && m.sourcemap.length > 0,
  ).length;
  if (withSourcemaps > 0) {
    lines.push(`With Sourcemaps: ${withSourcemaps}`);
  }

  const withBytecode = result.modules.filter(
    (m) => m.bytecode && m.bytecode.length > 0,
  ).length;
  if (withBytecode > 0) {
    lines.push(`With Bytecode: ${withBytecode}`);
  }

  if (result.args.length > 0) {
    lines.push(`Compile Args: ${result.args.join(" ")}`);
  }

  return lines.join("\n");
}
