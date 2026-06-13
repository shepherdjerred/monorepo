#!/usr/bin/env bun

/**
 * Generate TypeScript types for Helm charts used in the cdk8s application.
 * This script is specific to the cdk8s project and uses the helm-types library.
 */

// Using string concatenation instead of node:path
import { fetchHelmChart } from "@shepherdjerred/helm-types/src/chart-fetcher.ts";
import { convertToTypeScriptInterface } from "@shepherdjerred/helm-types/src/type-converter.ts";
import { generateTypeScriptCode } from "@shepherdjerred/helm-types/src/interface-generator.ts";
import type { TypeScriptInterface } from "@shepherdjerred/helm-types/src/types.ts";
import type { HelmValue } from "@shepherdjerred/helm-types/src/schemas.ts";
import type { JSONSchemaProperty } from "@shepherdjerred/helm-types/src/types.ts";
import {
  parseChartInfoFromVersions,
  type ChartInfo,
} from "./parse-helm-charts.ts";

const VERSIONS_FILE = "src/versions.ts";
const OUTPUT_DIR = "generated/helm";

async function main() {
  console.log("🚀 Starting Helm chart TypeScript type generation...");

  try {
    await generateHelmTypes();
  } catch (error) {
    console.error("💥 Type generation failed:", error);
    process.exit(1);
  }
}

const MAX_FETCH_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 3000;

async function generateHelmTypes() {
  // Do NOT wipe the output directory: chart fetches hit the network and can
  // flake transiently. A blanket `rm -rf` followed by per-chart regeneration
  // means a single flaky fetch silently deletes a committed type file (the
  // historical promtail/kube-prometheus-stack drift). Instead, write each file
  // in place, keep existing files on failure, prune only charts that no longer
  // exist in versions.ts, and fail the whole run if any chart could not be
  // generated — so a partial/destructive tree is never produced.
  await Bun.$`mkdir -p ${OUTPUT_DIR}`.quiet();

  // Parse chart information from versions.ts
  console.log(`📋 Parsing chart information from ${VERSIONS_FILE}...`);
  const charts = await parseChartInfoFromVersions(VERSIONS_FILE);

  if (charts.length === 0) {
    console.log("⚠️  No Helm charts found in versions file");
    return;
  }

  console.log(`✅ Found ${charts.length.toString()} Helm charts:`);
  charts.forEach((chart) => {
    console.log(`   - ${chart.name} (${chart.version}) from ${chart.repoUrl}`);
  });

  // Generate types for each chart, retrying transient (network) fetch failures.
  const failures: string[] = [];

  for (const chart of charts) {
    console.log(`\n🔍 Processing ${chart.name}...`);
    let generated = false;
    for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
      try {
        await generateChartTypes(chart);
        generated = true;
        console.log(`✅ Generated types for ${chart.name}`);
        break;
      } catch (error) {
        if (attempt < MAX_FETCH_ATTEMPTS) {
          console.warn(
            `⚠️  Attempt ${attempt.toString()}/${MAX_FETCH_ATTEMPTS.toString()} for ${chart.name} failed; retrying...`,
          );
          await Bun.sleep(RETRY_BACKOFF_MS);
        } else {
          console.error(
            `❌ Failed to process ${chart.name} after ${MAX_FETCH_ATTEMPTS.toString()} attempts:`,
            error,
          );
        }
      }
    }
    if (!generated) {
      failures.push(chart.name);
    }
  }

  // Prune type files for charts no longer present in versions.ts (deterministic,
  // based on versions.ts rather than fetch success).
  await pruneStaleTypeFiles(charts.map((c) => c.name));

  // Regenerate the index from the type files that actually exist on disk (every
  // expected chart, freshly generated or retained from a prior run).
  const indexFiles: string[] = [];
  for (const chart of charts) {
    if (await Bun.file(`${OUTPUT_DIR}/${chart.name}.types.ts`).exists()) {
      indexFiles.push(`${chart.name}.types.ts`);
    }
  }
  if (indexFiles.length > 0) {
    await generateIndexFile(indexFiles);
    console.log(
      `\n✅ Generated index.ts with ${indexFiles.length.toString()} exports`,
    );
  }

  if (indexFiles.length > 0) {
    // Run prettier on generated files
    console.log("\n🎨 Running prettier on generated files...");
    try {
      const prettierProc = Bun.spawn(
        ["bun", "x", "prettier", "--write", OUTPUT_DIR],
        {
          stdio: ["inherit", "inherit", "inherit"],
        },
      );

      const prettierExitCode = await prettierProc.exited;
      if (prettierExitCode === 0) {
        console.log("✅ Prettier formatting completed");
      } else {
        console.warn(
          `Prettier failed with code ${prettierExitCode.toString()}, continuing...`,
        );
      }
    } catch (error) {
      console.warn(`Failed to run prettier: ${String(error)}, continuing...`);
    }

    // Run TypeScript compilation check
    console.log("\n🔧 Running TypeScript compilation check...");
    try {
      // Use shell to expand glob pattern
      const tscProc = Bun.spawn(
        ["sh", "-c", `bun x tsc --noEmit --skipLibCheck "${OUTPUT_DIR}"/*.ts`],
        {
          stdio: ["inherit", "pipe", "pipe"],
        },
      );

      const tscOutput = await new Response(tscProc.stderr).text();
      const tscExitCode = await tscProc.exited;

      if (tscExitCode === 0) {
        console.log("✅ TypeScript compilation check passed");
      } else {
        console.warn("⚠️  TypeScript compilation issues found:");
        console.warn(tscOutput);
        console.warn("Generated types may have compilation errors");
      }
    } catch (error) {
      console.warn(
        `Failed to run TypeScript check: ${String(error)}, continuing...`,
      );
    }
  }

  console.log("\n🎉 Helm chart type generation completed!");
  if (indexFiles.length > 0) {
    console.log(
      `📁 ${indexFiles.length.toString()} type files in ${OUTPUT_DIR}`,
    );
    console.log(`🔍 Files validated with prettier, tsc`);
  }

  // Fail loudly if any chart could not be generated. The committed files for
  // those charts (if any) are left untouched, but the run is not "clean" — so
  // callers (CI, the weekly refresh workflow) must not treat the tree as fresh.
  if (failures.length > 0) {
    throw new Error(
      `Failed to generate types for ${failures.length.toString()} chart(s): ${failures.join(", ")}. Existing files for these charts were left in place.`,
    );
  }
}

/**
 * Generate types for any Helm chart
 */
async function generateChartTypes(chart: ChartInfo) {
  console.log(`  📊 Fetching Helm values for ${chart.name}...`);

  // Fetch the actual Helm chart values, schema, and comments
  const chartData: {
    values: HelmValue;
    schema: JSONSchemaProperty | null;
    yamlComments: Map<string, string>;
  } = await fetchHelmChart(chart);
  const { values: helmValues, schema, yamlComments } = chartData;

  // Debug logging for main script
  console.log(
    `  🔍 Found ${Object.keys(helmValues).length.toString()} top-level properties`,
  );
  if (Object.keys(helmValues).length <= 5) {
    console.log(`  🔍 Keys: ${Object.keys(helmValues).join(", ")}`);
  }

  if (Object.keys(helmValues).length === 0) {
    console.warn(
      `  ⚠️  No values found for ${chart.name}, generating empty interface`,
    );

    // Generate minimal type for charts with no values
    const code = `// Generated TypeScript types for ${chart.name} Helm chart

export type ${capitalizeFirst(chart.name).replaceAll("-", "")}HelmValues = object;

export type ${capitalizeFirst(chart.name).replaceAll("-", "")}HelmParameters = {
  [key: string]: string;
};
`;

    const filePath = `${OUTPUT_DIR}/${chart.name}.types.ts`;
    await Bun.write(filePath, code);
    return;
  }

  console.log(`  🏗️  Converting to TypeScript interfaces...`);
  const interfaceName = `${capitalizeFirst(chart.name).replaceAll("-", "")}HelmValues`;
  const tsInterface: TypeScriptInterface = convertToTypeScriptInterface({
    values: helmValues,
    interfaceName,
    schema,
    yamlComments,
    chartName: chart.name,
  });
  const code: string = generateTypeScriptCode(tsInterface, chart.name);

  const filePath = `${OUTPUT_DIR}/${chart.name}.types.ts`;
  await Bun.write(filePath, code);
}

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Remove `<chart>.types.ts` files for charts that are no longer declared in
 * versions.ts. Driven entirely by versions.ts (not fetch success), so it never
 * deletes a file just because that chart's fetch flaked.
 */
async function pruneStaleTypeFiles(expectedChartNames: string[]) {
  const expected = new Set(expectedChartNames.map((n) => `${n}.types.ts`));
  const lsOutput = await Bun.$`ls -1 ${OUTPUT_DIR}`.quiet().text();
  for (const entry of lsOutput.split("\n").map((s) => s.trim())) {
    if (entry === "" || !entry.endsWith(".types.ts") || expected.has(entry)) {
      continue;
    }
    console.log(`  🧹 Pruning stale type file: ${entry}`);
    await Bun.$`rm -f ${`${OUTPUT_DIR}/${entry}`}`.quiet();
  }
}

/**
 * Generate index.ts file that re-exports all chart types
 */
async function generateIndexFile(generatedFiles: string[]) {
  let content = "// Auto-generated index file for Helm chart types\n\n";

  for (const file of generatedFiles) {
    const moduleName = file.replace(".types.ts", "");
    content += `export * from "./${moduleName}.types.ts";\n`;
  }

  const indexPath = `${OUTPUT_DIR}/index.ts`;
  await Bun.write(indexPath, content);
}

// Run if this script is executed directly
if (import.meta.main) {
  void main();
}
