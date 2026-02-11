#!/usr/bin/env bun

import { $ } from "bun";

/**
 * Entity state mappings - defines which entities should have their state
 * converted from `string` to specific union types
 */
const ENTITY_STATE_MAPPINGS = {
  "vacuum.roomba": ["error", "docked", "charging", "paused", "returning", "cleaning", "idle", "unavailable"],
} as const;

/**
 * Generate types using @digital-alchemy/type-writer
 *
 * Note: @digital-alchemy/type-writer is patched via `bun patch` to fix a bug
 * where escapeCommentContent doesn't handle undefined content.
 * See: patches/@digital-alchemy%2Ftype-writer@25.10.12.patch
 */
async function generateTypes() {
  console.log("🔄 Generating types with @digital-alchemy/type-writer...");

  try {
    // Use the locally installed and patched version
    // This ensures the bun patch is applied (bunx creates fresh installs that bypass patches)
    // Use import.meta.resolve to find the package location, then construct the path to main.mjs
    // This works regardless of node_modules structure (hoisted, workspace, or .bun cache)
    const pkgUrl = import.meta.resolve("@digital-alchemy/type-writer");
    // Convert file:// URL to filesystem path
    const pkgPath = new URL(pkgUrl).pathname;
    const typeWriterDir = pkgPath.replace(/\/dist\/index\.mjs$/, "");
    const mainPath = `${typeWriterDir}/dist/main.mjs`;
    await $`bun ${mainPath}`;
    console.log("✅ Types generated successfully");
  } catch (error) {
    console.error("❌ Failed to generate types:", error);
    process.exit(1);
  }
}

/**
 * Add TypeScript disable comments to generated files
 */
async function addTsDisableComments() {
  console.log("🔄 Adding TypeScript disable comments to generated files...");

  const generatedFiles = ["src/hass/registry.mts", "src/hass/services.mts", "src/hass/mappings.mts"];

  for (const filePath of generatedFiles) {
    try {
      let content = await Bun.file(filePath).text();

      // Check if TypeScript disable comments are already present
      if (!content.includes("@ts-nocheck")) {
        // Add TypeScript disable comments at the top after the existing header
        const lines = content.split("\n");
        let insertIndex = 0;

        // Find where to insert (after existing header comments)
        for (let i = 0; i < lines.length; i++) {
          if (lines[i]?.startsWith("//") || lines[i]?.trim() === "") {
            insertIndex = i + 1;
          } else {
            break;
          }
        }

        // Insert TypeScript disable comments
        const tsDisableComments = ["// @ts-nocheck", "/* eslint-disable */", ""];

        lines.splice(insertIndex, 0, ...tsDisableComments);
        content = lines.join("\n");

        await Bun.write(filePath, content);
        console.log(`✅ Added TypeScript disable comments to ${filePath}`);
      } else {
        console.log(`✅ TypeScript disable comments already present in ${filePath}`);
      }
    } catch (error) {
      console.error(`❌ Failed to process ${filePath}:`, error);
    }
  }
}

/**
 * Post-process registry.mts to convert state strings to unions
 */
async function postProcessRegistry() {
  console.log("🔄 Post-processing registry.mts...");

  const registryPath = "src/hass/registry.mts";

  try {
    let content = await Bun.file(registryPath).text();

    // Process each entity in the mapping
    for (const [entityId, states] of Object.entries(ENTITY_STATE_MAPPINGS)) {
      const unionType = states.map((state) => `"${state}"`).join(" | ");

      // Create a regex to match the entity definition and replace state: string
      const entityPattern = new RegExp(`("${entityId.replace(/\./g, "\\.")}":\\s*{[^}]*?)state:\\s*string;`, "s");

      const replacement = `$1state: ${unionType};`;

      if (entityPattern.test(content)) {
        content = content.replace(entityPattern, replacement);
        console.log(`✅ Updated state type for ${entityId}`);
      } else {
        console.log(`⚠️  Could not find entity ${entityId} in registry.mts`);
      }
    }

    // Write the updated content back to the file
    await Bun.write(registryPath, content);
    console.log("✅ Registry post-processing completed");
  } catch (error) {
    console.error("❌ Failed to post-process registry:", error);
    process.exit(1);
  }
}

/**
 * Validate that the post-processing worked correctly
 */
async function validateProcessing() {
  console.log("🔄 Validating post-processing...");

  const registryPath = "src/hass/registry.mts";

  try {
    const content = await Bun.file(registryPath).text();

    let allValid = true;

    for (const [entityId, states] of Object.entries(ENTITY_STATE_MAPPINGS)) {
      const unionType = states.map((state) => `"${state}"`).join(" | ");
      const expectedPattern = new RegExp(
        `"${entityId.replace(/\./g, "\\.")}":\\s*{[^}]*?state:\\s*${unionType.replace(/[|()]/g, "\\$&")};`,
        "s",
      );

      if (expectedPattern.test(content)) {
        console.log(`✅ ${entityId} state type is correct`);
      } else {
        console.log(`❌ ${entityId} state type validation failed`);
        allValid = false;
      }
    }

    if (allValid) {
      console.log("✅ All validations passed");
    } else {
      console.log("❌ Some validations failed");
      process.exit(1);
    }
  } catch (error) {
    console.error("❌ Failed to validate processing:", error);
    process.exit(1);
  }
}

/**
 * Main execution function
 */
async function main() {
  console.log("🚀 Starting Home Assistant type generation and post-processing...");

  // Step 1: Generate types
  await generateTypes();

  // Step 2: Add TypeScript disable comments to generated files
  await addTsDisableComments();

  // Step 3: Post-process registry
  await postProcessRegistry();

  // Step 4: Validate processing
  await validateProcessing();

  console.log("🎉 Type generation and post-processing completed successfully!");
}

// Execute if run directly
if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error("❌ Script failed:", error);
    process.exit(1);
  });
}
