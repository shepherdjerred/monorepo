// Using Bun.$ for path operations instead of node:path
import { parse as yamlParse } from "yaml";
import type { ChartInfo, JSONSchemaProperty } from "./types.ts";
import { HelmValueSchema, RecordSchema, ErrorSchema } from "./schemas.ts";
import type { HelmValue } from "./schemas.ts";
import { parseYAMLComments } from "./yaml-comments.ts";

/**
 * Load JSON schema if it exists in the chart
 */
async function loadJSONSchema(
  chartPath: string,
): Promise<JSONSchemaProperty | null> {
  try {
    const schemaPath = `${chartPath}/values.schema.json`;
    const schemaContent = await Bun.file(schemaPath).text();
    const parsed: unknown = JSON.parse(schemaContent);
    // Validate that parsed is an object
    const recordCheck = RecordSchema.safeParse(parsed);
    if (!recordCheck.success) {
      return null;
    }
    // Note: JSONSchemaProperty is a structural type
    const schema: JSONSchemaProperty = recordCheck.data;
    console.log(`  📋 Loaded values.schema.json`);
    return schema;
  } catch {
    // Schema doesn't exist or couldn't be parsed - that's okay
    return null;
  }
}

/**
 * Run a command and return its output using Bun
 */
async function runCommand(command: string, args: string[]): Promise<string> {
  try {
    const proc = Bun.spawn([command, ...args], {
      stdout: "pipe",
      stderr: "inherit",
    });

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode === 0) {
      return output;
    } else {
      throw new Error(
        `Command "${command} ${args.join(" ")}" failed with code ${exitCode.toString()}`,
      );
    }
  } catch (error) {
    const parseResult = ErrorSchema.safeParse(error);
    const errorMessage = parseResult.success
      ? parseResult.data.message
      : String(error);
    throw new Error(
      `Failed to spawn command "${command} ${args.join(" ")}": ${errorMessage}`,
      { cause: error },
    );
  }
}

/**
 * Fetch a Helm chart and extract its values.yaml and optional schema
 */
export async function fetchHelmChart(chart: ChartInfo): Promise<{
  values: HelmValue;
  schema: JSONSchemaProperty | null;
  yamlComments: Map<string, string>;
}> {
  const pwd = Bun.env["PWD"] ?? process.cwd();
  const tempDir = `${pwd}/temp/helm-${chart.name}`;
  const repoName = `temp-repo-${chart.name}-${String(Date.now())}`;

  try {
    // Ensure temp directory exists
    await Bun.$`mkdir -p ${tempDir}`.quiet();

    console.log(`  📦 Adding Helm repo: ${chart.repoUrl}`);
    // Add the helm repo
    await runCommand("helm", ["repo", "add", repoName, chart.repoUrl]);

    console.log(`  🔄 Updating Helm repos...`);
    // Update repo
    await runCommand("helm", ["repo", "update"]);

    console.log(`  ⬇️  Pulling chart ${chart.chartName}:${chart.version}...`);
    // Pull the chart
    await runCommand("helm", [
      "pull",
      `${repoName}/${chart.chartName}`,
      "--version",
      chart.version,
      "--destination",
      tempDir,
      "--untar",
    ]);

    // Read values.yaml
    const valuesPath = `${tempDir}/${chart.chartName}/values.yaml`;
    console.log(`  📖 Reading values.yaml from ${valuesPath}`);

    try {
      const valuesContent = await Bun.file(valuesPath).text();

      // Parse YAML comments
      const yamlComments = parseYAMLComments(valuesContent);
      console.log(
        `  💬 Extracted ${String(yamlComments.size)} comments from values.yaml`,
      );

      // Parse YAML using yaml package
      const parsedValues = yamlParse(valuesContent) as unknown;
      console.log(`  ✅ Successfully parsed values.yaml`);
      const recordParseResult = RecordSchema.safeParse(parsedValues);
      if (recordParseResult.success) {
        console.log(
          `  🔍 Parsed values keys: ${Object.keys(recordParseResult.data)
            .slice(0, 10)
            .join(
              ", ",
            )}${Object.keys(recordParseResult.data).length > 10 ? "..." : ""}`,
        );
      }

      // Check if parsedValues is a valid object using Zod before validation
      if (!recordParseResult.success) {
        console.warn(
          `  ⚠️  Parsed values is not a valid record object: ${String(parsedValues)}`,
        );
        return { values: {}, schema: null, yamlComments: new Map() };
      }

      // Validate and parse with Zod for runtime type safety
      const parseResult = HelmValueSchema.safeParse(recordParseResult.data);

      // Try to load JSON schema
      const chartPath = `${tempDir}/${chart.chartName}`;
      const schema = await loadJSONSchema(chartPath);

      if (parseResult.success) {
        console.log(`  ✅ Zod validation successful`);
        return { values: parseResult.data, schema, yamlComments };
      } else {
        console.warn(`  ⚠️  Zod validation failed for ${chart.name}:`);
        console.warn(
          `    First few errors:`,
          parseResult.error.issues.slice(0, 3),
        );
        console.warn(
          `  ⚠️  Falling back to unvalidated object for type generation`,
        );
        // Return the validated record data from the successful parse result
        return { values: recordParseResult.data, schema, yamlComments };
      }
    } catch (error) {
      console.warn(`  ⚠️  Failed to read/parse values.yaml: ${String(error)}`);
      return { values: {}, schema: null, yamlComments: new Map() };
    }
  } finally {
    // Cleanup
    try {
      console.log(`  🧹 Cleaning up...`);
      await runCommand("helm", ["repo", "remove", repoName]);
      await Bun.$`rm -rf ${tempDir}`.quiet();
    } catch (cleanupError) {
      console.warn(`Cleanup failed for ${chart.name}:`, String(cleanupError));
    }
  }
}
