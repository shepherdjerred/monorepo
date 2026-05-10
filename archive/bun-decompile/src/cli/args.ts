/**
 * CLI argument parsing and validation for bun-decompile.
 *
 * Handles:
 * - parseArgs configuration
 * - Provider/concurrency validation
 * - Input file existence checks
 * - API key format validation
 */

import { parseArgs } from "node:util";
import path from "node:path";

export const USAGE = `
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

export type CliOptions = {
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
};

export type ValidatedInput = {
  binaryPath: string | undefined;
  filePath: string | undefined;
  outputPath: string;
  options: CliOptions;
};

/**
 * Parse and validate CLI arguments.
 * Critical errors: exits with error message if validation fails.
 */
export function parseAndValidateArgs(): {
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
      `Error: --provider must be 'openai' or 'anthropic', got '${provider}'`,
    );
    process.exit(1);
  }

  // Validate concurrency
  const concurrency = Number.parseInt(values.concurrency, 10);
  if (Number.isNaN(concurrency) || concurrency < 1) {
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
export async function validateInput(
  binary: string | undefined,
  options: CliOptions,
): Promise<ValidatedInput> {
  if (options.help) {
    console.log(USAGE);
    process.exit(0);
  }

  const outputPath = path.resolve(options.output);

  // File-only mode: de-minify a JS file directly
  if (options.file != null && options.file.length > 0) {
    const filePath = path.resolve(options.file);

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
  if (binary == null || binary.length === 0) {
    console.log(USAGE);
    process.exit(1);
  }

  const binaryPath = path.resolve(binary);

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
export function validateApiKey(
  apiKey: string | undefined,
  provider: "openai" | "anthropic",
): string {
  if (apiKey == null || apiKey.length === 0) {
    const envKey =
      provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
    console.error(`\nError: De-minification requires an API key.`);
    console.error(
      `Provide via --api-key flag or ${envKey} environment variable.`,
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
