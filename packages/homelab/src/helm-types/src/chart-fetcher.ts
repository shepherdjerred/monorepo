import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { parse as yamlParse } from "yaml";
import { HelmValueSchema, RecordSchema } from "./schemas.js";
import type { HelmValue } from "./schemas.js";
import type { ChartInfo, JSONSchemaProperty } from "./types.js";
import { parseYAMLComments } from "./yaml-comments.js";

export type FetchedHelmChart = {
  values: HelmValue;
  schema: JSONSchemaProperty | null;
  yamlComments: Map<string, string>;
};

const MissingFileError = z.object({ code: z.literal("ENOENT") });

async function loadJsonSchema(
  chartPath: string,
): Promise<JSONSchemaProperty | null> {
  const schemaPath = path.join(chartPath, "values.schema.json");
  let schemaContent: string;
  try {
    schemaContent = await readFile(schemaPath, "utf8");
  } catch (error: unknown) {
    if (MissingFileError.safeParse(error).success) {
      return null;
    }
    throw new Error(`Failed to read ${schemaPath}`, { cause: error });
  }

  const parsed: unknown = JSON.parse(schemaContent);
  return RecordSchema.parse(parsed);
}

async function runCommand(
  command: string,
  args: readonly string[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      reject(
        new Error(`Failed to start ${command}: ${error.message}`, {
          cause: error,
        }),
      );
    });
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      const status = signal === null ? String(code) : `signal ${signal}`;
      reject(
        new Error(
          `${command} ${args.join(" ")} failed with ${status}: ${stderr.trim()}`,
        ),
      );
    });
  });
}

async function resolveUntarredChartDir(
  tempDir: string,
  fallbackName: string,
): Promise<string> {
  const fallback = path.join(tempDir, fallbackName);
  const entries = await readdir(tempDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name === fallbackName) {
      return fallback;
    }
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      return path.join(tempDir, entry.name);
    }
  }
  throw new Error(`Helm did not extract a chart directory in ${tempDir}`);
}

/**
 * Download a chart into an isolated temporary directory and read its values,
 * optional JSON schema, and YAML documentation comments. The caller's Helm
 * repository configuration is never modified.
 */
export async function fetchHelmChart(
  chart: ChartInfo,
): Promise<FetchedHelmChart> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "helm-types-"));
  try {
    const chartReference =
      chart.oci === true
        ? `oci://${chart.repoUrl}/${chart.chartName}`
        : chart.chartName;
    const pullArgs = [
      "pull",
      chartReference,
      "--version",
      chart.version,
      "--destination",
      tempDir,
      "--untar",
    ];
    if (chart.oci !== true) {
      pullArgs.push("--repo", chart.repoUrl);
    }
    await runCommand("helm", pullArgs);

    const chartDir = await resolveUntarredChartDir(tempDir, chart.chartName);
    const valuesPath = path.join(chartDir, "values.yaml");
    const valuesContent = await readFile(valuesPath, "utf8");
    const yamlComments = parseYAMLComments(valuesContent);
    const parsedValues: unknown = yamlParse(valuesContent);
    const values = HelmValueSchema.parse(RecordSchema.parse(parsedValues));
    const schema = await loadJsonSchema(chartDir);

    return { values, schema, yamlComments };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
