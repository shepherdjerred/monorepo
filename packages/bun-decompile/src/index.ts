#!/usr/bin/env bun
/**
 * CLI entry point for bun-decompile.
 *
 * Error handling strategy:
 * - Critical errors (invalid input, file not found, invalid args) → exit with error message
 * - Recoverable errors (single module failure) → log and continue with other modules
 * - All errors are caught at the top level to ensure clean exit
 */

import { parseArgs } from "node:util";
import { resolve, join } from "node:path";
import { mkdir } from "node:fs/promises";
import {
  decompileFile,
  extractToDirectory,
  getExtractionSummary,
} from "./lib/index.ts";
import { DecompileError } from "./lib/errors.ts";
import {
  createConfig,
  Deminifier,
  formatStats,
  interactiveConfirmCost,
  ProgressDisplay,
} from "./lib/deminify/index.ts";
import type { ExtendedProgress } from "./lib/deminify/index.ts";
import type { DecompileResult } from "./lib/types.ts";

const USAGE = `
bun-decompile - Extract and de-minify sources from Bun compiled executables

Usage:
  bun-decompile <binary> [options]
  bun-decompile --file <js-file> --deminify [options]

Arguments:
  binary                  Path to the Bun-compiled executable

Options:
  -o, --output <dir>      Output directory (default: ./decompiled)
  -f, --file <path>       De-minify a JS file directly (skip decompilation)
  -v, --verbose           Show detailed information
  -q, --quiet             Suppress progress display
  -h, --help              Show this help message

De-minification Options:
  --deminify              Enable AI de-minification of extracted JS
  --provider <name>       LLM provider: openai or anthropic (default: openai)
  --api-key <key>         API key (or set OPENAI_API_KEY / ANTHROPIC_API_KEY)
  --model <model>         Model to use (default: gpt-5-nano)
  --batch                 Use batch API (Anthropic only, 50% cheaper)
  --resume <batch-id>     Resume a pending batch job
  --no-cache              Disable result caching
  --concurrency <n>       Parallel API requests (default: 3)
  --yes                   Skip cost confirmation prompt

Examples:
  bun-decompile ./myapp
  bun-decompile ./myapp -o ./extracted
  bun-decompile ./myapp --deminify                         # Uses OpenAI GPT-5 Nano
  bun-decompile ./myapp --deminify --provider anthropic    # Use Claude
  bun-decompile ./myapp --deminify --provider anthropic --batch  # Batch mode
  bun-decompile ./myapp --deminify -q                      # Quiet mode
  bun-decompile -f ./minified.js --deminify --yes          # De-minify a JS file directly
`.trim();

type CliOptions = {
  output: string;
  file: string | undefined;
  verbose: boolean;
  quiet: boolean;
  help: boolean;
  deminify: boolean;
  provider: "openai" | "anthropic";
  apiKey: string | undefined;
  model: string;
  batch: boolean;
  resume: string | undefined;
  noCache: boolean;
  concurrency: number;
  yes: boolean;
}

type ValidatedInput = {
  binaryPath: string | undefined;
  filePath: string | undefined;
  outputPath: string;
  options: CliOptions;
}

// ============================================================================
// Input Validation
// ============================================================================

/**
 * Parse and validate CLI arguments.
 * Critical errors: exits with error message if validation fails.
 */
function parseAndValidateArgs(): {
  binary: string | undefined;
  options: CliOptions;
} {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      output: {
        type: "string",
        short: "o",
        default: "./decompiled",
      },
      file: {
        type: "string",
        short: "f",
      },
      verbose: {
        type: "boolean",
        short: "v",
        default: false,
      },
      quiet: {
        type: "boolean",
        short: "q",
        default: false,
      },
      help: {
        type: "boolean",
        short: "h",
        default: false,
      },
      deminify: {
        type: "boolean",
        default: false,
      },
      provider: {
        type: "string",
        default: "openai",
      },
      "api-key": {
        type: "string",
      },
      model: {
        type: "string",
        default: "gpt-5-nano",
      },
      batch: {
        type: "boolean",
        default: false,
      },
      resume: {
        type: "string",
      },
      "no-cache": {
        type: "boolean",
        default: false,
      },
      concurrency: {
        type: "string",
        default: "3",
      },
      yes: {
        type: "boolean",
        short: "y",
        default: false,
      },
    },
  });

  // Validate provider
  const provider = values.provider;
  if (provider !== "openai" && provider !== "anthropic") {
    console.error(
      `Error: --provider must be 'openai' or 'anthropic', got '${provider}'`
    );
    process.exit(1);
  }

  // Validate concurrency
  const concurrency = Number.parseInt(values.concurrency, 10);
  if (isNaN(concurrency) || concurrency < 1) {
    console.error("Error: --concurrency must be a positive integer");
    process.exit(1);
  }
  if (concurrency > 20) {
    console.error("Error: --concurrency cannot exceed 20 (API rate limits)");
    process.exit(1);
  }

  return {
    binary: positionals[0],
    options: {
      output: values.output,
      file: values.file,
      verbose: values.verbose,
      quiet: values.quiet,
      help: values.help,
      deminify: values.deminify,
      provider: provider,
      apiKey: values["api-key"],
      model: values.model,
      batch: values.batch,
      resume: values.resume,
      noCache: values["no-cache"],
      concurrency,
      yes: values.yes,
    },
  };
}

/**
 * Validate input file and resolve paths.
 * Critical errors: exits if binary path is missing or file doesn't exist.
 */
async function validateInput(
  binary: string | undefined,
  options: CliOptions
): Promise<ValidatedInput> {
  if (options.help) {
    console.log(USAGE);
    process.exit(0);
  }

  const outputPath = resolve(options.output);

  // File-only mode: de-minify a JS file directly
  if (options.file) {
    const filePath = resolve(options.file);

    // Check if file exists
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      console.error(`Error: File not found: ${filePath}`);
      process.exit(1);
    }

    // File mode requires --deminify
    if (!options.deminify) {
      console.error("Error: --file requires --deminify flag");
      process.exit(1);
    }

    return { binaryPath: undefined, filePath, outputPath, options };
  }

  // Binary mode: decompile a Bun executable
  if (!binary) {
    console.log(USAGE);
    process.exit(1);
  }

  const binaryPath = resolve(binary);

  // Check if file exists
  const file = Bun.file(binaryPath);
  if (!(await file.exists())) {
    console.error(`Error: File not found: ${binaryPath}`);
    process.exit(1);
  }

  return { binaryPath, filePath: undefined, outputPath, options };
}

/**
 * Validate API key format.
 * Returns the validated key or exits with error.
 */
function validateApiKey(
  apiKey: string | undefined,
  provider: "openai" | "anthropic"
): string {
  if (!apiKey) {
    const envKey =
      provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
    console.error(`\nError: De-minification requires an API key.`);
    console.error(
      `Provide via --api-key flag or ${envKey} environment variable.`
    );
    process.exit(1);
  }

  // Basic format validation (don't log the key in error messages)
  if (apiKey.length < 10) {
    console.error("\nError: API key appears to be invalid (too short).");
    process.exit(1);
  }

  return apiKey;
}

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
  verbose: boolean
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
// De-minification
// ============================================================================

/**
 * Run AI de-minification on extracted modules.
 * Recoverable errors: individual module failures are logged but processing continues.
 */
async function runDeminification(
  result: DecompileResult,
  outputPath: string,
  options: CliOptions
): Promise<void> {
  // Get and validate API key
  const envKey =
    options.provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
  const apiKey = validateApiKey(
    options.apiKey ?? Bun.env[envKey],
    options.provider
  );

  console.log("\n--- De-minification ---");
  console.log(`Provider: ${options.provider} | Model: ${options.model}`);

  const config = createConfig(apiKey, outputPath, {
    provider: options.provider,
    model: options.model,
    cacheEnabled: !options.noCache,
    concurrency: options.concurrency,
    verbose: options.verbose,
  });

  const deminifier = new Deminifier(config);

  // Get JS modules to de-minify
  const jsModules = result.modules.filter(
    (m) =>
      m.loader === "js" ||
      m.loader === "jsx" ||
      m.loader === "tsx" ||
      m.loader === "ts"
  );

  if (jsModules.length === 0) {
    console.log("No JavaScript modules found to de-minify.");
    return;
  }

  console.log(`Found ${String(jsModules.length)} JavaScript module(s) to de-minify.`);

  // Create deminified output directory
  const deminifiedDir = join(outputPath, "deminified");
  await mkdir(deminifiedDir, { recursive: true });

  for (const module of jsModules) {
    if (module.contents.length === 0) {continue;}

    const source = new TextDecoder().decode(module.contents);
    const fileName = module.name || "unknown.js";

    console.log(`\nProcessing: ${fileName}`);

    // Estimate cost
    const estimate = deminifier.estimateCost(source);
    if (estimate.functionCount === 0) {
      console.log("  No functions to de-minify, skipping.");
      continue;
    }

    // Confirm cost if not skipped
    let confirmed = options.yes;
    if (!confirmed) {
      confirmed = await interactiveConfirmCost(estimate);
    }

    if (!confirmed) {
      console.log("  Skipped.");
      continue;
    }

    // Create progress display
    const progressDisplay = new ProgressDisplay({
      quiet: options.quiet,
      showBar: true,
      showStats: true,
    });

    // Track last progress for finish (mutable container for callback)
    const progressState: { last: ExtendedProgress | null } = { last: null };

    try {
      const deminifyOptions: NonNullable<
        Parameters<typeof deminifier.deminifyFile>[1]
      > = {
        fileName,
        isEntryPoint: module.isEntryPoint,
        skipConfirmation: true, // Already confirmed above
        useBatch: options.batch,
        outputPath: deminifiedDir,
      };

      // Only add optional properties when defined
      if (options.resume) {
        deminifyOptions.resumeBatchId = options.resume;
      }

      // Only add progress callback for non-batch mode
      if (!options.batch) {
        deminifyOptions.onExtendedProgress = (progress) => {
          progressState.last = progress;
          progressDisplay.update(progress);
        };
      }

      const deminified = await deminifier.deminifyFile(source, deminifyOptions);

      // Show completion
      if (progressState.last) {
        progressDisplay.finish(progressState.last);
      } else {
        progressDisplay.clear();
      }

      // Write de-minified output
      let outFileName = module.name.replace(/^\//, "");
      if (!outFileName) {outFileName = "module.js";}
      if (!outFileName.endsWith(".js")) {
        outFileName += ".js";
      }

      const outPath = join(deminifiedDir, outFileName);
      const outDir = join(
        deminifiedDir,
        ...outFileName.split("/").slice(0, -1)
      );
      await mkdir(outDir, { recursive: true });
      await Bun.write(outPath, deminified);

      console.log(`Written to: ${outPath}`);

      if (options.verbose) {
        const stats = deminifier.getStats();
        console.log(formatStats(stats));
      }
    } catch (error) {
      // Recoverable error: log and continue with next module
      progressDisplay.clear();
      console.error(
        `Error processing ${fileName}: ${(error as Error).message}`
      );
    }
  }
}

// ============================================================================
// File-Only De-minification
// ============================================================================

/**
 * Run AI de-minification on a standalone JS file.
 * This bypasses the decompilation step entirely.
 */
async function runFileDeminification(
  filePath: string,
  outputPath: string,
  options: CliOptions
): Promise<void> {
  // Get and validate API key
  const envKey =
    options.provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
  const apiKey = validateApiKey(
    options.apiKey ?? Bun.env[envKey],
    options.provider
  );

  console.log(`De-minifying: ${filePath}`);
  console.log(`Provider: ${options.provider} | Model: ${options.model}`);

  const config = createConfig(apiKey, outputPath, {
    provider: options.provider,
    model: options.model,
    cacheEnabled: !options.noCache,
    concurrency: options.concurrency,
    verbose: options.verbose,
  });

  const deminifier = new Deminifier(config);

  // Read the file
  const source = await Bun.file(filePath).text();
  const fileName = filePath.split("/").pop() ?? "unknown.js";

  // Estimate cost
  const estimate = deminifier.estimateCost(source);
  if (estimate.functionCount === 0) {
    console.log("No functions to de-minify.");
    return;
  }

  // Confirm cost if not skipped
  let confirmed = options.yes;
  if (!confirmed) {
    confirmed = await interactiveConfirmCost(estimate);
  }

  if (!confirmed) {
    console.log("Skipped.");
    return;
  }

  // Create deminified output directory
  const deminifiedDir = join(outputPath, "deminified");
  await mkdir(deminifiedDir, { recursive: true });

  // Create progress display
  const progressDisplay = new ProgressDisplay({
    quiet: options.quiet,
    showBar: true,
    showStats: true,
  });

  // Track last progress for finish (mutable container for callback)
  const progressState: { last: ExtendedProgress | null } = { last: null };

  try {
    const deminifyOptions: NonNullable<
      Parameters<typeof deminifier.deminifyFile>[1]
    > = {
      fileName,
      isEntryPoint: true,
      skipConfirmation: true,
      useBatch: options.batch,
      outputPath: deminifiedDir,
    };

    if (options.resume) {
      deminifyOptions.resumeBatchId = options.resume;
    }

    if (!options.batch) {
      deminifyOptions.onExtendedProgress = (progress) => {
        progressState.last = progress;
        progressDisplay.update(progress);
      };
    }

    const deminified = await deminifier.deminifyFile(source, deminifyOptions);

    // Show completion
    if (progressState.last) {
      progressDisplay.finish(progressState.last);
    } else {
      progressDisplay.clear();
    }

    // Write de-minified output
    let outFileName = fileName;
    if (!outFileName.endsWith(".js")) {
      outFileName += ".js";
    }

    const outPath = join(deminifiedDir, outFileName);
    await Bun.write(outPath, deminified);

    console.log(`\nWritten to: ${outPath}`);

    if (options.verbose) {
      const stats = deminifier.getStats();
      console.log(formatStats(stats));
    }
  } catch (error) {
    progressDisplay.clear();
    throw error;
  }
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
  const { binaryPath, filePath, outputPath } = await validateInput(binary, options);

  // File-only mode: de-minify a JS file directly
  if (filePath) {
    await runFileDeminification(filePath, outputPath, options);
    console.log("\nDone!");
    return;
  }

  // Binary mode: decompile and optionally de-minify
  if (!binaryPath) {
    console.error("Error: No input file specified");
    process.exit(1);
  }

  // Run decompilation
  const result = await runDecompilation(
    binaryPath,
    outputPath,
    options.verbose
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
main().catch((error: unknown) => {
  if (error instanceof DecompileError) {
    console.error(`Error: ${error.message}`);
  } else if (error instanceof Error) {
    console.error(`Unexpected error: ${error.message}`);
    if (Bun.env["DEBUG"]) {
      console.error(error.stack);
    }
  } else {
    console.error("Unknown error occurred");
  }
  process.exit(1);
});
