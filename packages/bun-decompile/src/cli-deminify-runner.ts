/**
 * De-minification runner functions for CLI.
 *
 * Handles orchestrating the de-minification process for both:
 * - Binary mode (decompile + deminify)
 * - File-only mode (deminify a standalone JS file)
 */

import path from "node:path";
import { mkdir } from "node:fs/promises";
import { Deminifier } from "./lib/deminify/deminifier.ts";
import {
  createConfig,
  formatStats,
  interactiveConfirmCost,
} from "./lib/deminify/deminify-utils.ts";
import { ProgressDisplay } from "./lib/deminify/progress-display.ts";
import type { ExtendedProgress } from "./lib/deminify/types.ts";
import type { DecompileResult } from "./lib/types.ts";
import type { CliOptions } from "./cli-args.ts";
import { validateApiKey } from "./cli-args.ts";

/** Options for processing a single module */
type ProcessModuleOptions = {
  deminifier: Deminifier;
  source: string;
  fileName: string;
  moduleName: string;
  isEntryPoint: boolean;
  deminifiedDir: string;
  cliOptions: CliOptions;
};

/**
 * Run AI de-minification on extracted modules.
 * Recoverable errors: individual module failures are logged but processing continues.
 */
export async function runDeminification(
  result: DecompileResult,
  outputPath: string,
  options: CliOptions,
): Promise<void> {
  // Get and validate API key
  const envKey =
    options.provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
  const apiKey = validateApiKey(
    options.apiKey ?? Bun.env[envKey],
    options.provider,
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
      m.loader === "ts",
  );

  if (jsModules.length === 0) {
    console.log("No JavaScript modules found to de-minify.");
    return;
  }

  console.log(
    `Found ${String(jsModules.length)} JavaScript module(s) to de-minify.`,
  );

  // Create deminified output directory
  const deminifiedDir = path.join(outputPath, "deminified");
  await mkdir(deminifiedDir, { recursive: true });

  for (const module of jsModules) {
    if (module.contents.length === 0) {
      continue;
    }

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

    await processModule({
      deminifier,
      source,
      fileName,
      moduleName: module.name,
      isEntryPoint: module.isEntryPoint,
      deminifiedDir,
      cliOptions: options,
    });
  }
}

/**
 * Process a single module for de-minification.
 */
async function processModule(opts: ProcessModuleOptions): Promise<void> {
  const {
    deminifier,
    source,
    fileName,
    moduleName,
    isEntryPoint,
    deminifiedDir,
    cliOptions,
  } = opts;

  // Create progress display
  const progressDisplay = new ProgressDisplay({
    quiet: cliOptions.quiet,
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
      isEntryPoint,
      skipConfirmation: true, // Already confirmed above
      useBatch: cliOptions.batch,
      outputPath: deminifiedDir,
    };

    // Only add optional properties when defined
    if (cliOptions.resume != null && cliOptions.resume.length > 0) {
      deminifyOptions.resumeBatchId = cliOptions.resume;
    }

    // Only add progress callback for non-batch mode
    if (!cliOptions.batch) {
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
    let outFileName = moduleName.replace(/^\//, "");
    if (!outFileName) {
      outFileName = "module.js";
    }
    if (!outFileName.endsWith(".js")) {
      outFileName += ".js";
    }

    const outPath = path.join(deminifiedDir, outFileName);
    const outDir = path.join(
      deminifiedDir,
      ...outFileName.split("/").slice(0, -1),
    );
    await mkdir(outDir, { recursive: true });
    await Bun.write(outPath, deminified);

    console.log(`Written to: ${outPath}`);

    if (cliOptions.verbose) {
      const stats = deminifier.getStats();
      console.log(formatStats(stats));
    }
  } catch (error) {
    // Recoverable error: log and continue with next module
    progressDisplay.clear();
    console.error(
      `Error processing ${fileName}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Run AI de-minification on a standalone JS file.
 * This bypasses the decompilation step entirely.
 */
export async function runFileDeminification(
  filePath: string,
  outputPath: string,
  options: CliOptions,
): Promise<void> {
  // Get and validate API key
  const envKey =
    options.provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
  const apiKey = validateApiKey(
    options.apiKey ?? Bun.env[envKey],
    options.provider,
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
  const deminifiedDir = path.join(outputPath, "deminified");
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

    if (options.resume != null && options.resume.length > 0) {
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

    const outPath = path.join(deminifiedDir, outFileName);
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
