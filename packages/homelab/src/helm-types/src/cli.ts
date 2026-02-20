#!/usr/bin/env bun
/**
 * CLI for @homelab/helm-types
 *
 * Generate TypeScript types from Helm charts
 */
import { z } from "zod";
import { fetchHelmChart } from "./chart-fetcher.ts";
import { convertToTypeScriptInterface } from "./type-converter.ts";
import { generateTypeScriptCode } from "./interface-generator.ts";
import type { ChartInfo } from "./types.ts";

const ErrorSchema = z.object({
  message: z.string(),
});

const HELP_TEXT = String.raw`
helm-types - Generate TypeScript types from Helm charts

USAGE:
  bunx @homelab/helm-types [options]

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
  bunx @homelab/helm-types \
    --name argo-cd \
    --repo https://argoproj.github.io/argo-helm \
    --version 8.3.1

  # Generate types with custom output file
  bunx @homelab/helm-types \
    --name argo-cd \
    --repo https://argoproj.github.io/argo-helm \
    --version 8.3.1 \
    --output argo-cd.types.ts

  # Generate types with custom chart name and interface name
  bunx @homelab/helm-types \
    --name argocd \
    --chart argo-cd \
    --repo https://argoproj.github.io/argo-helm \
    --version 8.3.1 \
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
 * Simple argument parser for Bun CLI
 */
function parseCliArgs(args: string[]): CliArgs {
  const result: CliArgs = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg == null || arg === "") {
      continue;
    }

    if (HELP_FLAGS.has(arg)) {
      result.help = true;
      continue;
    }

    const key = FLAG_MAP[arg];
    if (key != null) {
      const value = args[i + 1];
      if (value != null && value !== "") {
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

async function main() {
  try {
    const args = parseCliArgs(Bun.argv.slice(2));

    // Show help
    if (args.help === true) {
      console.log(HELP_TEXT);
      process.exit(0);
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
      process.exit(1);
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
      await Bun.write(args.output, code);
      console.error("");
      console.error(`✅ Types written to: ${args.output}`);
    } else {
      // Write to stdout (so it can be piped)
      console.log(code);
    }

    process.exit(0);
  } catch (error) {
    const parseResult = ErrorSchema.safeParse(error);
    if (parseResult.success) {
      console.error(`Error: ${parseResult.data.message}`);
    } else {
      console.error(`Error: ${String(error)}`);
    }
    process.exit(1);
  }
}

/**
 * Convert a string to PascalCase
 */
function toPascalCase(str: string): string {
  return str
    .split(/[-_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
}

void main();
