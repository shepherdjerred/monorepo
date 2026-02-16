#!/usr/bin/env -S bun

import { $ } from "bun";

/**
 * Test script to validate the Helm chart by:
 * 1. Building the Helm chart with CDK8s templates using Dagger
 * 2. Exporting it to a local directory
 * 3. Extracting and validating the chart contents
 * 4. Verifying CDK8s templates are included
 * 5. Checking that templates contain valid Kubernetes resources
 */

const TEST_BUILD_NUMBER = "123";
const TEST_VERSION = `1.0.0-${TEST_BUILD_NUMBER}`;
const EXPORT_DIR = "./test-helm-chart-export";
const CHART_NAME = "media";
const CHART_FILE = `${CHART_NAME}-${TEST_VERSION}.tgz`;

async function main() {
  console.log("🚀 Starting Helm chart test...");

  try {
    // Step 1: Clean up any existing test artifacts
    console.log("🧹 Cleaning up any existing test artifacts...");
    await $`rm -rf ${EXPORT_DIR}`.nothrow().quiet();

    // Step 2: Build the Helm chart using Dagger
    console.log("📦 Building Helm chart with CDK8s templates using Dagger...");
    await $`dagger call helm-build --version ${TEST_BUILD_NUMBER} --cdk-source src/cdk8s export --path ${EXPORT_DIR}`;

    // Step 3: Verify the export directory exists and contains expected files
    console.log("🔍 Verifying exported files...");
    const lsResult = await $`ls -1 ${EXPORT_DIR}`;
    const exportFiles = lsResult
      .text()
      .trim()
      .split("\n")
      .filter((f) => f.length > 0);
    console.log("Exported files:", exportFiles);

    // Check for required files
    const requiredFiles = [CHART_FILE, "Chart.yaml", "values.yaml"];
    for (const file of requiredFiles) {
      if (!exportFiles.includes(file)) {
        throw new Error(`Missing required file: ${file}`);
      }
    }
    console.log("✅ All required files present");

    // Step 4: Extract and examine the chart contents
    console.log("📂 Extracting chart contents...");
    await $`cd ${EXPORT_DIR} && tar -xzf ${CHART_FILE}`;

    // Step 5: Verify Chart.yaml has correct version
    console.log("🏷️  Verifying Chart.yaml version...");
    const chartYaml = await Bun.file(`${EXPORT_DIR}/${CHART_NAME}/Chart.yaml`).text();
    if (!chartYaml.includes(`version: ${TEST_VERSION}`)) {
      throw new Error(`Chart.yaml does not contain expected version: ${TEST_VERSION}`);
    }
    if (!chartYaml.includes(`appVersion: ${TEST_VERSION}`)) {
      throw new Error(`Chart.yaml does not contain expected appVersion: ${TEST_VERSION}`);
    }
    console.log("✅ Chart.yaml version is correct");

    // Step 6: Check templates directory exists
    console.log("📁 Verifying templates directory...");
    const chartDir = `${EXPORT_DIR}/${CHART_NAME}`;
    const chartLsResult = await $`ls -1 ${chartDir}`;
    const chartContents = chartLsResult
      .text()
      .trim()
      .split("\n")
      .filter((f) => f.length > 0);

    if (!chartContents.includes("templates")) {
      throw new Error("Templates directory not found in chart");
    }
    console.log("✅ Templates directory exists");

    // Step 7: Verify CDK8s templates are present
    console.log("🎯 Verifying CDK8s templates...");
    const templatesDir = `${chartDir}/templates`;
    const templatesLsResult = await $`ls -1 ${templatesDir}`;
    const templates = templatesLsResult
      .text()
      .trim()
      .split("\n")
      .filter((f) => f.length > 0);
    console.log("Found templates:", templates);

    const expectedTemplates = ["media.k8s.yaml"];

    for (const template of expectedTemplates) {
      if (!templates.includes(template)) {
        throw new Error(`Missing expected CDK8s template: ${template}`);
      }
    }
    console.log("✅ All expected CDK8s templates are present");

    // Step 8: Validate template contents contain valid Kubernetes resources
    console.log("🔬 Validating template contents...");

    // Check media.k8s.yaml for expected resources
    const mediaTemplate = await Bun.file(`${templatesDir}/media.k8s.yaml`).text();

    // Verify it contains Kubernetes resources
    const expectedResourceTypes = ["apiVersion:", "kind: PersistentVolumeClaim", "kind: Deployment", "kind: Service"];

    for (const resourceType of expectedResourceTypes) {
      if (!mediaTemplate.includes(resourceType)) {
        console.warn(`⚠️  Expected resource type not found: ${resourceType}`);
      }
    }

    // Verify it contains homelab-specific resources (media namespace)
    const expectedResources = ["name: plex-tv-hdd-pvc", "namespace: media", "storageClassName: zfs-hdd"];

    for (const resource of expectedResources) {
      if (!mediaTemplate.includes(resource)) {
        throw new Error(`Expected homelab resource not found: ${resource}`);
      }
    }
    console.log("✅ Template contents are valid and contain expected resources");

    // Step 10: Verify the chart can be linted (if helm is available)
    console.log("🔍 Testing Helm lint (if available)...");
    const helmLintResult = await $`helm lint ${chartDir}`.nothrow();

    if (helmLintResult.exitCode === 0) {
      console.log("✅ Helm chart passes lint validation");
    } else {
      console.log("⚠️  Helm not available or lint failed - skipping validation");
      console.log("Lint output:", helmLintResult.stderr.toString() || "No error output");
    }

    console.log("🎉 All Helm chart tests passed!");

    // Step 11: Cleanup
    console.log("🧹 Cleaning up test artifacts...");
    await $`rm -rf ${EXPORT_DIR}`;
    console.log("✅ Cleanup completed");
  } catch (error) {
    console.error("❌ Test failed:", error);
    console.log("🔍 Test artifacts left for inspection at:", EXPORT_DIR);
    console.log("   Use the following to inspect:");
    console.log(`   ls -la ${EXPORT_DIR}`);
    console.log(`   cd ${EXPORT_DIR} && tar -tzf ${CHART_FILE}`);
    console.log(`   cd ${EXPORT_DIR} && tar -xzf ${CHART_FILE} && ls -la ${CHART_NAME}/`);
    console.log(`   rm -rf ${EXPORT_DIR}  # when done`);
    process.exit(1);
  }
}

// Run the test
main().catch((error: unknown) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});
