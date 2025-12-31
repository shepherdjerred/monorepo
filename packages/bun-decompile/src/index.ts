#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { decompileFile, extractToDirectory, getExtractionSummary } from "./lib/index.ts";
import { DecompileError } from "./lib/errors.ts";
import {
  createConfig,
  Deminifier,
  formatStats,
  interactiveConfirmCost,
  ProgressDisplay,
} from "./lib/deminify/index.ts";
import type { ExtendedProgress } from "./lib/deminify/index.ts";

const USAGE = `
bun-decompile - Extract and de-minify sources from Bun compiled executables

Usage:
  bun-decompile <binary> [options]

Arguments:
  binary                  Path to the Bun-compiled executable

Options:
  -o, --output <dir>      Output directory (default: ./decompiled)
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
`.trim();

interface CliOptions {
  output: string;
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

function parseCliArgs(): { binary: string | undefined; options: CliOptions } {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      output: {
        type: "string",
        short: "o",
        default: "./decompiled",
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

  const provider = (values.provider ?? "openai") as "openai" | "anthropic";

  return {
    binary: positionals[0],
    options: {
      output: values.output ?? "./decompiled",
      verbose: values.verbose ?? false,
      quiet: values.quiet ?? false,
      help: values.help ?? false,
      deminify: values.deminify ?? false,
      provider,
      apiKey: values["api-key"],
      model: values.model ?? "gpt-5-nano",
      batch: values.batch ?? false,
      resume: values.resume,
      noCache: values["no-cache"] ?? false,
      concurrency: parseInt(values.concurrency ?? "3", 10),
      yes: values.yes ?? false,
    },
  };
}

async function main(): Promise<void> {
  const { binary, options } = parseCliArgs();

  if (options.help || !binary) {
    console.log(USAGE);
    process.exit(options.help ? 0 : 1);
  }

  const binaryPath = resolve(binary);
  const outputPath = resolve(options.output);

  console.log(`Decompiling: ${binaryPath}`);

  // Check if file exists
  const file = Bun.file(binaryPath);
  if (!(await file.exists())) {
    console.error(`Error: File not found: ${binaryPath}`);
    process.exit(1);
  }

  // Decompile
  const result = await decompileFile(binaryPath);

  if (options.verbose) {
    console.log("\n" + getExtractionSummary(result));
  }

  // Extract
  console.log(`\nExtracting to: ${outputPath}`);
  await extractToDirectory(result, outputPath);

  // Summary
  console.log(`\nExtracted ${result.modules.length} module(s)`);

  if (!options.verbose) {
    const entryPoint = result.modules.find((m) => m.isEntryPoint);
    if (entryPoint) {
      console.log(`Entry point: ${entryPoint.name}`);
    }
  }

  // De-minification
  if (options.deminify) {
    // Get API key based on provider
    const envKey = options.provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
    const apiKey = options.apiKey ?? process.env[envKey];
    if (!apiKey) {
      console.error(`\nError: De-minification requires an API key.`);
      console.error(`Provide via --api-key flag or ${envKey} environment variable.`);
      process.exit(1);
    }

    console.log("\n--- De-minification ---");
    console.log(`Provider: ${options.provider} | Model: ${options.model}`);

    const config = createConfig(apiKey, {
      provider: options.provider,
      model: options.model,
      cacheEnabled: !options.noCache,
      concurrency: options.concurrency,
      verbose: options.verbose,
    });

    const deminifier = new Deminifier(config);
    const { mkdir } = await import("node:fs/promises");
    const { join } = await import("node:path");

    // Get JS modules to de-minify
    const jsModules = result.modules.filter(
      (m) => m.loader === "js" || m.loader === "jsx" || m.loader === "tsx" || m.loader === "ts",
    );

    if (jsModules.length === 0) {
      console.log("No JavaScript modules found to de-minify.");
    } else {
      console.log(`Found ${jsModules.length} JavaScript module(s) to de-minify.`);

      // Create deminified output directory
      const deminifiedDir = join(outputPath, "deminified");
      await mkdir(deminifiedDir, { recursive: true });

      for (const module of jsModules) {
        if (module.contents.length === 0) continue;

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

        // Track last progress for finish
        let lastProgress: ExtendedProgress | null = null;

        try {
          const deminifyOptions: NonNullable<Parameters<typeof deminifier.deminifyFile>[1]> = {
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
              lastProgress = progress;
              progressDisplay.update(progress);
            };
          }

          const deminified = await deminifier.deminifyFile(source, deminifyOptions);

          // Show completion
          if (lastProgress) {
            progressDisplay.finish(lastProgress);
          } else {
            progressDisplay.clear();
          }

          // Write de-minified output
          let outFileName = module.name?.replace(/^\//, "") || "module.js";
          if (!outFileName.endsWith(".js")) {
            outFileName += ".js";
          }

          const outPath = join(deminifiedDir, outFileName);
          const outDir = join(deminifiedDir, ...outFileName.split("/").slice(0, -1));
          await mkdir(outDir, { recursive: true });
          await Bun.write(outPath, deminified);

          console.log(`Written to: ${outPath}`);

          if (options.verbose) {
            const stats = deminifier.getStats();
            console.log(formatStats(stats));
          }
        } catch (error) {
          progressDisplay.clear();
          console.error(`Error: ${(error as Error).message}`);
        }
      }
    }
  }

  console.log("\nDone!");
}

main().catch((error: unknown) => {
  if (error instanceof DecompileError) {
    console.error(`Error: ${error.message}`);
  } else if (error instanceof Error) {
    console.error(`Unexpected error: ${error.message}`);
    if (process.env["DEBUG"]) {
      console.error(error.stack);
    }
  } else {
    console.error("Unknown error occurred");
  }
  process.exit(1);
});
