#!/usr/bin/env node
/**
 * CLI for @shepherdjerred/helm-types
 *
 * Generate TypeScript types from Helm charts
 */
import { realpath, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { fetchHelmChart } from "./chart-fetcher.js";
import { convertToTypeScriptInterface } from "./type-converter.js";
import { generateTypeScriptCode } from "./interface-generator.js";
import type { ChartInfo } from "./types.js";

const HELP_TEXT = String.raw`
helm-types - Generate TypeScript types from Helm charts

USAGE:
  npx @shepherdjerred/helm-types [options]

OPTIONS:
  --name, -n          Unique identifier for the chart (required)
  --chart, -c         Chart name in the repository (defaults to --name)
  --repo, -r          Helm repository URL (required)
  --version, -v       Chart version (required)
  --output, -o        Output file path (defaults to stdout)
  --interface, -i     Interface name (auto-generated from chart name if not provided)
  --help, -h          Show this help message

EXAMPLES:
  # Generate types for ArgoCD and print to stdout
  npx @shepherdjerred/helm-types \
    --name argo-cd \
    --repo https://argoproj.github.io/argo-helm \
    --version 7.7.16

  # Generate types with custom output file
  npx @shepherdjerred/helm-types \
    --name argo-cd \
    --repo https://argoproj.github.io/argo-helm \
    --version 7.7.16 \
    --output argo-cd.types.ts

  # Generate types with custom chart name and interface name
  npx @shepherdjerred/helm-types \
    --name argocd \
    --chart argo-cd \
    --repo https://argoproj.github.io/argo-helm \
    --version 7.7.16 \
    --interface ArgocdHelmValues \
    --output argocd.types.ts
`;

type CliArgs = {
  name?: string;
  chart?: string;
  repo?: string;
  version?: string;
  output?: string;
  interface?: string;
  help?: boolean;
};

/** String-valued flag names (excludes boolean 'help') */
type StringCliArgsKey = Exclude<keyof CliArgs, "help">;

/** Map from flag name to CliArgs key */
const FLAG_MAP: Record<string, StringCliArgsKey> = {
  "--name": "name",
  "-n": "name",
  "--chart": "chart",
  "-c": "chart",
  "--repo": "repo",
  "-r": "repo",
  "--version": "version",
  "-v": "version",
  "--output": "output",
  "-o": "output",
  "--interface": "interface",
  "-i": "interface",
};

const HELP_FLAGS = new Set(["--help", "-h"]);

/**
 * Simple argument parser for the Node and Bun CLI.
 */
function parseCliArgs(args: string[]): CliArgs {
  const result: CliArgs = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "" || arg == null) {
      continue;
    }

    if (HELP_FLAGS.has(arg)) {
      result.help = true;
      continue;
    }

    const key = FLAG_MAP[arg];
    if (key != null) {
      const value = args[i + 1];
      if (value !== "" && value != null) {
        result[key] = value;
        i += 1;
      }
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return result;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  try {
    const args = parseCliArgs(argv);

    // Show help
    if (args.help === true) {
      console.log(HELP_TEXT);
      return;
    }

    // Validate required arguments
    if (
      args.name == null ||
      args.name === "" ||
      args.repo == null ||
      args.repo === "" ||
      args.version == null ||
      args.version === ""
    ) {
      console.error("Error: Missing required arguments");
      console.error("Required: --name, --repo, --version");
      console.error("\nRun with --help for usage information");
      process.exitCode = 1;
      return;
    }

    // Build chart info
    const chartInfo: ChartInfo = {
      name: args.name,
      chartName: args.chart ?? args.name,
      repoUrl: args.repo,
      version: args.version,
    };

    // Generate interface name from chart name if not provided
    const interfaceName =
      args.interface ?? `${toPascalCase(args.name)}HelmValues`;

    console.error(
      `Fetching chart: ${chartInfo.chartName}@${chartInfo.version}`,
    );
    console.error(`Repository: ${chartInfo.repoUrl}`);
    console.error("");

    // Fetch chart
    const { values, schema, yamlComments } = await fetchHelmChart(chartInfo);

    console.error("");
    console.error(`Converting to TypeScript interface: ${interfaceName}`);

    // Convert to TypeScript interface
    const tsInterface = convertToTypeScriptInterface({
      values,
      interfaceName,
      schema,
      yamlComments,
      chartName: args.name,
    });

    // Generate TypeScript code
    const code = generateTypeScriptCode(tsInterface, args.name);

    // Write to file or stdout
    if (args.output != null && args.output !== "") {
      await writeFile(args.output, code, "utf8");
      console.error("");
      console.error(`✅ Types written to: ${args.output}`);
    } else {
      // Write to stdout (so it can be piped)
      console.log(code);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  }
}

/**
 * Convert a string to PascalCase
 */
export function toPascalCase(str: string): string {
  return str
    .split(/[-_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
}

async function isMainModule(): Promise<boolean> {
  const entrypoint = process.argv[1];
  if (entrypoint === undefined) return false;
  return (
    (await realpath(entrypoint)) ===
    (await realpath(fileURLToPath(import.meta.url)))
  );
}

if (await isMainModule()) {
  void main();
}
