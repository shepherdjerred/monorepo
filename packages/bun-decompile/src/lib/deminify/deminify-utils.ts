/**
 * Utility functions for de-minification.
 *
 * Provides:
 * - Default config creation
 * - Interactive cost confirmation
 * - Progress formatting for CLI display
 * - Stats formatting
 * - High-level deminify() convenience function
 */

import { formatCostEstimate } from "./claude-client.ts";
import { Deminifier } from "./deminifier.ts";
import type {
  CostEstimate,
  DeminifyConfig,
  DeminifyProgress,
  DeminifyStats,
} from "./types.ts";
import type { DeminifyFileOptions } from "./deminifier.ts";

/** High-level function for simple usage */
export async function deminify(
  source: string,
  config: DeminifyConfig,
  options?: DeminifyFileOptions,
): Promise<string> {
  const deminifier = new Deminifier(config);
  return deminifier.deminifyFile(source, options);
}

/** Create default config with API key and output path */
export function createConfig(
  apiKey: string,
  outputPath: string,
  overrides?: Partial<DeminifyConfig>,
): DeminifyConfig {
  const cacheDir = `${outputPath}/cache`;

  const defaults: Omit<DeminifyConfig, "apiKey"> = {
    provider: "openai",
    model: "gpt-5-nano",
    maxTokens: 16_384, // GPT-5 nano uses reasoning tokens, needs more headroom
    cacheEnabled: true,
    cacheDir,
    concurrency: 3,
    rateLimit: 50,
    verbose: false,
    maxFunctionSize: 50_000,
    minFunctionSize: 5, // Process almost all functions
  };

  return {
    ...defaults,
    ...overrides,
    apiKey,
  };
}

/** Interactive cost confirmation for CLI */
export async function interactiveConfirmCost(
  estimate: CostEstimate,
): Promise<boolean> {
  console.log("\n" + formatCostEstimate(estimate));
  console.log("");

  // Use Bun's readline for interactive confirmation
  const response = await new Promise<string>((resolve) => {
    process.stdout.write("Proceed with de-minification? [y/N] ");

    // Set up stdin for reading
    process.stdin.setRawMode(false);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    const onData = (data: string) => {
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      resolve(data.trim().toLowerCase());
    };

    process.stdin.on("data", onData);
  });

  return response === "y" || response === "yes";
}

/** Format progress for CLI display */
export function formatProgress(progress: DeminifyProgress): string {
  const percent =
    progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0;

  const phases: Record<DeminifyProgress["phase"], string> = {
    parsing: "Parsing source",
    analyzing: "Analyzing functions",
    deminifying: "De-minifying",
    reassembling: "Reassembling",
  };

  let msg = `[${String(percent)}%] ${phases[progress.phase]}`;
  if (progress.currentItem != null && progress.currentItem.length > 0) {
    msg += `: ${progress.currentItem}`;
  }

  return msg;
}

/** Format stats for display */
export function formatStats(stats: DeminifyStats): string {
  const lines: string[] = [];
  lines.push(`Functions processed: ${String(stats.functionsProcessed)}`);
  lines.push(`Cache hits: ${String(stats.cacheHits)}`);
  lines.push(`Cache misses: ${String(stats.cacheMisses)}`);
  lines.push(`Errors: ${String(stats.errors)}`);
  lines.push(`Input tokens: ${stats.inputTokensUsed.toLocaleString()}`);
  lines.push(`Output tokens: ${stats.outputTokensUsed.toLocaleString()}`);
  lines.push(
    `Average confidence: ${(stats.averageConfidence * 100).toFixed(1)}%`,
  );
  lines.push(`Time: ${(stats.timeTaken / 1000).toFixed(1)}s`);
  return lines.join("\n");
}
