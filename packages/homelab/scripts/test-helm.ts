#!/usr/bin/env bun

import { existsSync, readdirSync, statSync, mkdtempSync, rmSync } from "fs";
import { execSync } from "child_process";
import { join, basename } from "path";
import { tmpdir } from "os";

/**
 * Test a single Helm chart.
 * @param chartTgz Path to the .tgz file
 * @param chartName Name of the chart for display
 */
function testSingleChart(chartTgz: string, chartName: string): void {
  console.log(`📦 Testing chart: ${chartName}`);
  console.log(`   Package: ${basename(chartTgz)}`);

  // Create temp directory for extraction
  const tempDir = mkdtempSync(join(tmpdir(), `helm-test-${chartName}-`));
  const originalDir = process.cwd();

  try {
    process.chdir(tempDir);

    // Extract the chart
    execSync(`tar -xzf ${chartTgz}`, { stdio: "pipe" });

    // Find the extracted directory
    const entries = readdirSync(".");
    const directories = entries.filter((entry) => {
      const stat = statSync(entry);
      return stat.isDirectory();
    });

    if (directories.length === 0) {
      throw new Error("No extracted directory found!");
    }

    const chartDir = directories[0];
    process.chdir(chartDir);

    // Check Chart.yaml
    if (!existsSync("Chart.yaml")) {
      throw new Error("Chart.yaml not found!");
    }

    // Check templates directory
    if (!existsSync("templates")) {
      throw new Error("Templates directory not found!");
    }

    const templateFiles = readdirSync("templates").filter((file) => file.endsWith(".yaml") || file.endsWith(".yml"));
    console.log(`   Found ${templateFiles.length} template files`);

    // Run helm lint
    execSync("helm lint .", { stdio: "pipe" });

    // Run helm template
    execSync("helm template test-release . > /dev/null", { stdio: "pipe" });

    console.log(`   ✅ ${chartName} passed all tests`);
  } finally {
    // Cleanup
    process.chdir(originalDir);
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Test Helm chart structure, linting, and template rendering.
 * Supports both single chart (flat .tgz files) and multi-chart (subdirectories) layouts.
 */
async function testHelmChart(): Promise<void> {
  try {
    console.log("🔍 Testing Helm charts...");
    console.log("");

    const rootDir = process.cwd();
    const entries = readdirSync(".");

    // Check for .tgz files directly in root (old single-chart layout)
    const rootTgzFiles = entries.filter((file) => file.endsWith(".tgz"));

    // Check for chart subdirectories (new multi-chart layout)
    const chartDirs = entries.filter((entry) => {
      const stat = statSync(entry);
      if (!stat.isDirectory() || entry === "node_modules" || entry.startsWith(".")) {
        return false;
      }
      // Check if directory contains a .tgz file
      const dirContents = readdirSync(entry);
      return dirContents.some((f) => f.endsWith(".tgz"));
    });

    if (rootTgzFiles.length === 0 && chartDirs.length === 0) {
      console.log("❌ No packaged charts found");
      process.exit(1);
    }

    const chartsToTest: Array<{ name: string; tgzPath: string }> = [];

    // Add root-level .tgz files (single-chart layout)
    for (const tgz of rootTgzFiles) {
      const chartName = tgz.replace(/-[\d.]+(-[a-z0-9.-]+)?\.tgz$/, "");
      chartsToTest.push({ name: chartName, tgzPath: join(rootDir, tgz) });
    }

    // Add charts from subdirectories (multi-chart layout)
    for (const dir of chartDirs) {
      const dirPath = join(rootDir, dir);
      const tgzFiles = readdirSync(dirPath).filter((f) => f.endsWith(".tgz"));
      for (const tgz of tgzFiles) {
        chartsToTest.push({ name: dir, tgzPath: join(dirPath, tgz) });
      }
    }

    console.log(`Found ${chartsToTest.length} chart(s) to test:`);
    for (const chart of chartsToTest) {
      console.log(`  - ${chart.name}`);
    }
    console.log("");

    // Test each chart
    let passed = 0;
    let failed = 0;

    for (const chart of chartsToTest) {
      try {
        testSingleChart(chart.tgzPath, chart.name);
        passed++;
      } catch (error) {
        console.log(`   ❌ ${chart.name} failed: ${error instanceof Error ? error.message : error}`);
        failed++;
      }
      console.log("");
    }

    // Summary
    console.log("─".repeat(40));
    console.log(`📊 Results: ${passed} passed, ${failed} failed`);

    if (failed > 0) {
      console.log("❌ Some charts failed testing");
      process.exit(1);
    }

    console.log("🎉 All Helm tests passed!");
  } catch (error) {
    console.error("❌ Unexpected error during Helm testing:", error);
    process.exit(1);
  }
}

// Run the test if this script is executed directly
if (import.meta.main) {
  await testHelmChart();
}
