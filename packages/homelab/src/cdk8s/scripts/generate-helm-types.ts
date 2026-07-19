#!/usr/bin/env bun

/**
 * Generate TypeScript types for Helm charts used in the cdk8s application.
 * This script is specific to the cdk8s project and uses the helm-types library.
 *
 * Modes:
 *   (default)  Regenerate `generated/helm/` in place from the chart versions in
 *              `src/versions.ts`.
 *   --check    Regenerate into a throwaway dir and FAIL (exit 1) if the result
 *              differs from the committed `generated/helm/` tree — without
 *              mutating it. Runs in CI as the `helm-types-drift-check`
 *              Buildkite step (PR-only, self-scoped to generator-input
 *              changes), so a versions.ts chart bump that wasn't regenerated
 *              fails its PR instead of drifting silently.
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
// Throwaway dir used by --check so the committed tree is never mutated. Kept as
// a sibling of OUTPUT_DIR under `generated/` so prettier resolves the SAME
// config and formats it identically to the committed tree. Deliberately NOT
// gitignored: prettier 3.x honors `.gitignore` by default, so a gitignored
// check dir would be left unformatted and every file would falsely read as
// drifted. It is wiped before and after each run (CI runs it in an ephemeral
// container, so a leftover dir is only ever a transient local artifact).
const CHECK_DIR = "generated/helm-types-check";

async function main() {
  const checkMode = Bun.argv.includes("--check");

  try {
    if (checkMode) {
      await checkHelmTypes();
    } else {
      console.log("🚀 Starting Helm chart TypeScript type generation...");
      await generateHelmTypes(OUTPUT_DIR);
    }
  } catch (error) {
    console.error("💥 Type generation failed:", error);
    process.exit(1);
  }
}

const MAX_FETCH_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 3000;

async function generateHelmTypes(outputDir: string) {
  // Do NOT wipe the output directory: chart fetches hit the network and can
  // flake transiently. A blanket `rm -rf` followed by per-chart regeneration
  // means a single flaky fetch silently deletes a committed type file (the
  // historical promtail/kube-prometheus-stack drift). Instead, write each file
  // in place, keep existing files on failure, prune only charts that no longer
  // exist in versions.ts, and fail the whole run if any chart could not be
  // generated — so a partial/destructive tree is never produced.
  //
  // (--check passes a fresh, empty throwaway dir here, so there is nothing to
  // wipe and nothing to preserve — the no-wipe invariant only matters for the
  // committed OUTPUT_DIR.)
  await Bun.$`mkdir -p ${outputDir}`.quiet();

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
        await generateChartTypes(chart, outputDir);
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
  await pruneStaleTypeFiles(
    charts.map((c) => c.name),
    outputDir,
  );

  // Regenerate the index from the type files that actually exist on disk (every
  // expected chart, freshly generated or retained from a prior run).
  const indexFiles: string[] = [];
  for (const chart of charts) {
    if (await Bun.file(`${outputDir}/${chart.name}.types.ts`).exists()) {
      indexFiles.push(`${chart.name}.types.ts`);
    }
  }
  if (indexFiles.length > 0) {
    await generateIndexFile(indexFiles, outputDir);
    console.log(
      `\n✅ Generated index.ts with ${indexFiles.length.toString()} exports`,
    );
  }

  if (indexFiles.length > 0) {
    // Format with the workspace's pinned prettier — the SAME prettier (and
    // .prettierrc + plugins) that pre-commit and CI enforce, since the
    // generated dir is covered by prettier (not excluded). This MUST succeed:
    // leaving the raw interface generator output (which wraps differently)
    // would commit files that fail the prettier gate and churn against the
    // committed tree. Fail the run rather than continuing with unformatted
    // output.
    console.log("\n🎨 Running prettier on generated files...");
    const prettierProc = Bun.spawn(
      ["bun", "x", "prettier", "--write", outputDir],
      {
        stdio: ["inherit", "inherit", "inherit"],
      },
    );
    const prettierExitCode = await prettierProc.exited;
    if (prettierExitCode !== 0) {
      throw new Error(
        `prettier failed (exit ${prettierExitCode.toString()}) — generated types would not match the repo's formatting`,
      );
    }
    console.log("✅ Prettier formatting completed");

    // Sanity-check that the generated type files are valid standalone
    // TypeScript. `--ignoreConfig` is required: passing files on the command
    // line while a tsconfig.json is present is a hard error (TS5112) otherwise.
    // We check only `*.types.ts` (self-contained type declarations) — `index.ts`
    // re-exports with `.ts` extensions, which need the project's
    // `allowImportingTsExtensions` and is validated by the cdk8s project
    // typecheck. This is a fast guardrail that the generator didn't emit broken
    // syntax/types; the project typecheck remains the authoritative strict check.
    console.log("\n🔧 Running TypeScript compilation check...");
    const tscProc = Bun.spawn(
      [
        "sh",
        "-c",
        `bun x tsc --noEmit --skipLibCheck --ignoreConfig "${outputDir}"/*.types.ts`,
      ],
      { stdio: ["inherit", "inherit", "inherit"] },
    );
    const tscExitCode = await tscProc.exited;
    if (tscExitCode !== 0) {
      throw new Error(
        `generated types failed tsc (exit ${tscExitCode.toString()}) — the generator emitted invalid TypeScript`,
      );
    }
    console.log("✅ TypeScript compilation check passed");
  }

  console.log("\n🎉 Helm chart type generation completed!");
  if (indexFiles.length > 0) {
    console.log(
      `📁 ${indexFiles.length.toString()} type files in ${outputDir}`,
    );
    console.log(`🔍 Files validated with prettier, tsc`);
  }

  // Fail loudly if any chart could not be generated. The committed files for
  // those charts (if any) are left untouched, but the run is not "clean" — so
  // callers (CI gate, local regeneration) must not treat the tree as fresh.
  if (failures.length > 0) {
    throw new Error(
      `Failed to generate types for ${failures.length.toString()} chart(s): ${failures.join(", ")}. Existing files for these charts were left in place.`,
    );
  }
}

/**
 * --check: regenerate into a throwaway dir and compare against the committed
 * tree. Exits non-zero (with the exact fix command) if they differ, so a chart
 * version bump that wasn't accompanied by `bun run generate-helm-types` fails
 * CI. The committed `generated/helm/` is never touched.
 */
async function checkHelmTypes() {
  console.log(
    "🔍 Checking committed Helm types against what versions.ts produces...",
  );
  await Bun.$`rm -rf ${CHECK_DIR}`.quiet();
  let drift: string[];
  try {
    await generateHelmTypes(CHECK_DIR);
    drift = await compareTypeDirs(OUTPUT_DIR, CHECK_DIR);
  } finally {
    // Clean up HERE, before the drift check below: `process.exit()` does not
    // run finally blocks, so cleaning up after the exit would leak the
    // throwaway dir on the drift path.
    await Bun.$`rm -rf ${CHECK_DIR}`.quiet();
  }

  if (drift.length > 0) {
    console.error("\n❌ Committed Helm types are out of date:\n");
    for (const entry of drift) {
      console.error(`   - ${entry}`);
    }
    console.error(
      "\nThe committed generated/helm/ tree does not match what src/versions.ts produces.\n" +
        "Fix: run `bun run generate-helm-types` in packages/homelab/src/cdk8s, then\n" +
        "commit packages/homelab/src/cdk8s/generated/helm/.\n",
    );
    process.exit(1);
  }
  console.log("\n✅ Committed Helm types are in sync with src/versions.ts");
}

/** List the generated `.ts` files (chart types + index) in a directory. */
async function listTypeFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for await (const file of new Bun.Glob("*.ts").scan({
    cwd: dir,
    onlyFiles: true,
  })) {
    files.push(file);
  }
  return files.toSorted();
}

/**
 * Compare the committed type dir against a freshly generated one. Reports stale
 * files (committed but no longer generated), missing files (generated but not
 * committed), and content drift.
 */
async function compareTypeDirs(
  committedDir: string,
  freshDir: string,
): Promise<string[]> {
  const drift: string[] = [];
  const committed = new Set(await listTypeFiles(committedDir));
  const fresh = new Set(await listTypeFiles(freshDir));

  for (const name of [...new Set([...committed, ...fresh])].toSorted()) {
    if (committed.has(name) && !fresh.has(name)) {
      drift.push(
        `${name}: committed but no longer generated (stale — delete it)`,
      );
      continue;
    }
    if (!committed.has(name) && fresh.has(name)) {
      drift.push(`${name}: generated but not committed (add it)`);
      continue;
    }
    const committedText = await Bun.file(`${committedDir}/${name}`).text();
    const freshText = await Bun.file(`${freshDir}/${name}`).text();
    if (committedText !== freshText) {
      drift.push(`${name}: content differs from committed`);
    }
  }
  return drift;
}

/**
 * Generate types for any Helm chart
 */
async function generateChartTypes(chart: ChartInfo, outputDir: string) {
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

    const filePath = `${outputDir}/${chart.name}.types.ts`;
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

  const filePath = `${outputDir}/${chart.name}.types.ts`;
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
async function pruneStaleTypeFiles(
  expectedChartNames: string[],
  outputDir: string,
) {
  const expected = new Set(expectedChartNames.map((n) => `${n}.types.ts`));
  const lsOutput = await Bun.$`ls -1 ${outputDir}`.quiet().text();
  for (const entry of lsOutput.split("\n").map((s) => s.trim())) {
    if (entry === "" || !entry.endsWith(".types.ts") || expected.has(entry)) {
      continue;
    }
    console.log(`  🧹 Pruning stale type file: ${entry}`);
    await Bun.$`rm -f ${`${outputDir}/${entry}`}`.quiet();
  }
}

/**
 * Generate index.ts file that re-exports all chart types
 */
async function generateIndexFile(generatedFiles: string[], outputDir: string) {
  let content = "// Auto-generated index file for Helm chart types\n\n";

  for (const file of generatedFiles) {
    const moduleName = file.replace(".types.ts", "");
    content += `export * from "./${moduleName}.types.ts";\n`;
  }

  const indexPath = `${outputDir}/index.ts`;
  await Bun.write(indexPath, content);
}

// Run if this script is executed directly
if (import.meta.main) {
  void main();
}
