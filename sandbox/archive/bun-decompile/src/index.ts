#!/usr/bin/env bun
/**
 * CLI entry point for bun-decompile.
 *
 * Error handling strategy:
 * - Critical errors (invalid input, file not found, invalid args) -> exit with error message
 * - Recoverable errors (single module failure) -> log and continue with other modules
 * - All errors are caught at the top level to ensure clean exit
 */

import { decompileFile } from "./lib/parser.ts";
import { extractToDirectory, getExtractionSummary } from "./lib/extractor.ts";
import { DecompileError } from "./lib/errors.ts";
import type { DecompileResult } from "./lib/types.ts";
import { parseAndValidateArgs, validateInput } from "./cli/args.ts";
import {
  runDeminification,
  runFileDeminification,
} from "./cli/deminify-runner.ts";

// ============================================================================
// Decompilation
// ============================================================================

/**
 * Run decompilation and extraction.
 * Recoverable errors: throws DecompileError which is caught at top level.
 */
async function runDecompilation(
  binaryPath: string,
  outputPath: string,
  verbose: boolean,
): Promise<DecompileResult> {
  console.log(`Decompiling: ${binaryPath}`);

  const result = await decompileFile(binaryPath);

  if (verbose) {
    console.log("\n" + getExtractionSummary(result));
  }

  console.log(`\nExtracting to: ${outputPath}`);
  await extractToDirectory(result, outputPath);

  return result;
}

// ============================================================================
// Results Display
// ============================================================================

/**
 * Display extraction results summary.
 */
function displayResults(result: DecompileResult, verbose: boolean): void {
  console.log(`\nExtracted ${String(result.modules.length)} module(s)`);

  if (!verbose) {
    const entryPoint = result.modules.find((m) => m.isEntryPoint);
    if (entryPoint) {
      console.log(`Entry point: ${entryPoint.name}`);
    }
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  const { binary, options } = parseAndValidateArgs();
  const { binaryPath, filePath, outputPath } = await validateInput(
    binary,
    options,
  );

  // File-only mode: de-minify a JS file directly
  if (filePath != null && filePath.length > 0) {
    await runFileDeminification(filePath, outputPath, options);
    console.log("\nDone!");
    return;
  }

  // Binary mode: decompile and optionally de-minify
  if (binaryPath == null || binaryPath.length === 0) {
    console.error("Error: No input file specified");
    process.exit(1);
  }

  // Run decompilation
  const result = await runDecompilation(
    binaryPath,
    outputPath,
    options.verbose,
  );

  // Display extraction results
  displayResults(result, options.verbose);

  // Run de-minification if requested
  if (options.deminify) {
    await runDeminification(result, outputPath, options);
  }

  console.log("\nDone!");
}

// Top-level error handler
try {
  await main();
} catch (error: unknown) {
  if (error instanceof DecompileError) {
    console.error(`Error: ${error.message}`);
  } else if (error instanceof Error) {
    console.error(`Unexpected error: ${error.message}`);
    if (Bun.env["DEBUG"] != null && Bun.env["DEBUG"].length > 0) {
      console.error(error.stack);
    }
  } else {
    console.error("Unknown error occurred");
  }
  process.exit(1);
}
