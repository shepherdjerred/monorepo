#!/usr/bin/env bun

import { $ } from "bun";

/**
 * Entity state mappings - defines which entities should have their state
 * converted from `string` to specific union types
 */
const ENTITY_STATE_MAPPINGS = {
  "vacuum.roomba": [
    "error",
    "docked",
    "charging",
    "paused",
    "returning",
    "cleaning",
    "idle",
    "unavailable",
  ],
} as const;

const HASS_TOKEN_PLACEHOLDER = "YOUR LONG LIVED ACCESS TOKEN";

function parseEnvValue(envContent: string, key: string): string | undefined {
  const lines = envContent.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const normalized = line.startsWith("export ")
      ? line.slice("export ".length).trim()
      : line;
    const envMatch = /^([A-Z_]\w*)=(.*)$/i.exec(normalized);
    if (!envMatch) {
      continue;
    }

    const [, matchKey, matchValue] = envMatch;
    if (matchKey !== key || matchValue === undefined) {
      continue;
    }

    let value = matchValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    return value.trim();
  }

  return undefined;
}

async function resolveHassToken(): Promise<string | undefined> {
  const envToken = Bun.env["HASS_TOKEN"]?.trim();
  if (envToken !== undefined && envToken !== "") {
    return envToken;
  }

  const envFile = Bun.file(".env");
  if (!(await envFile.exists())) {
    return undefined;
  }

  const envContent = await envFile.text();
  const fileToken = parseEnvValue(envContent, "HASS_TOKEN");
  return fileToken?.trim() ?? undefined;
}

function isPlaceholderToken(token: string): boolean {
  return token.trim().toUpperCase() === HASS_TOKEN_PLACEHOLDER;
}

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

async function addDisableCommentsToFile(filePath: string) {
  let content = await Bun.file(filePath).text();

  if (content.includes("@ts-nocheck")) {
    console.log(
      `✅ TypeScript disable comments already present in ${filePath}`,
    );
    return;
  }

  const lines = content.split("\n");
  let insertIndex = 0;

  for (const [i, line] of lines.entries()) {
    if (line.startsWith("//") || line.trim() === "") {
      insertIndex = i + 1;
    } else {
      break;
    }
  }

  const tsDisableComments = ["// @ts-nocheck", "/* eslint-disable */", ""];

  lines.splice(insertIndex, 0, ...tsDisableComments);
  content = lines.join("\n");

  await Bun.write(filePath, content);
  console.log(`✅ Added TypeScript disable comments to ${filePath}`);
}

/**
 * Add TypeScript disable comments to generated files
 */
async function addTsDisableComments() {
  console.log("🔄 Adding TypeScript disable comments to generated files...");

  const generatedFiles = [
    "src/hass/registry.mts",
    "src/hass/services.mts",
    "src/hass/mappings.mts",
  ];

  for (const filePath of generatedFiles) {
    try {
      await addDisableCommentsToFile(filePath);
    } catch (error) {
      console.error(`❌ Failed to process ${filePath}:`, error);
    }
  }
}

/**
 * Service field type overrides — the type-writer generates incorrect types for
 * some service parameters. Each entry maps a service method to a field whose
 * type should be replaced.
 */
const SERVICE_FIELD_OVERRIDES: Record<
  string,
  { field: string; correctType: string }
> = {
  play_media: {
    field: "media",
    correctType: "{ media_content_id: string; media_content_type: string }",
  },
};

/**
 * Post-process services.mts to fix incorrect generated types
 */
async function postProcessServices() {
  console.log("🔄 Post-processing services.mts...");

  const servicesPath = "src/hass/services.mts";

  try {
    let content = await Bun.file(servicesPath).text();

    for (const [method, override] of Object.entries(SERVICE_FIELD_OVERRIDES)) {
      // Match the field declaration inside the service method's service_data.
      // The generated structure is: `method_name: (\n  service_data?: {\n  ...\n  field: string;`
      // Use a non-greedy match from the method name to the specific field.
      const pattern = new RegExp(
        String.raw`(${method}:\s*\([\s\S]*?)${override.field}:\s*string;`,
      );

      if (pattern.test(content)) {
        content = content.replace(
          pattern,
          `$1${override.field}: ${override.correctType};`,
        );
        console.log(`✅ Updated ${override.field} type in ${method} service`);
      } else {
        console.log(
          `⚠️  Could not find ${override.field}: string in ${method} service`,
        );
      }
    }

    await Bun.write(servicesPath, content);
    console.log("✅ Services post-processing completed");
  } catch (error) {
    console.error("❌ Failed to post-process services:", error);
    process.exit(1);
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
      const entityPattern = new RegExp(
        String.raw`("${entityId.replaceAll(".", String.raw`\.`)}":\s*{[^}]*?)state:\s*string;`,
        "s",
      );

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

  let allValid = true;

  // Validate registry
  const registryPath = "src/hass/registry.mts";

  try {
    const registryContent = await Bun.file(registryPath).text();

    for (const [entityId, states] of Object.entries(ENTITY_STATE_MAPPINGS)) {
      const unionType = states.map((state) => `"${state}"`).join(" | ");
      const expectedPattern = new RegExp(
        String.raw`"${entityId.replaceAll(".", String.raw`\.`)}":\s*{[^}]*?state:\s*${unionType.replaceAll(/[|()]/g, String.raw`\$&`)};`,
        "s",
      );

      if (expectedPattern.test(registryContent)) {
        console.log(`✅ ${entityId} state type is correct`);
      } else {
        console.log(`❌ ${entityId} state type validation failed`);
        allValid = false;
      }
    }
  } catch (error) {
    console.error("❌ Failed to validate registry:", error);
    process.exit(1);
  }

  // Validate services
  const servicesPath = "src/hass/services.mts";

  try {
    const servicesContent = await Bun.file(servicesPath).text();

    for (const [method, override] of Object.entries(SERVICE_FIELD_OVERRIDES)) {
      if (
        servicesContent.includes(`${override.field}: ${override.correctType};`)
      ) {
        console.log(`✅ ${method}.${override.field} type is correct`);
      } else {
        console.log(`❌ ${method}.${override.field} type validation failed`);
        allValid = false;
      }
    }
  } catch (error) {
    console.error("❌ Failed to validate services:", error);
    process.exit(1);
  }

  if (allValid) {
    console.log("✅ All validations passed");
  } else {
    console.log("❌ Some validations failed");
    process.exit(1);
  }
}

/**
 * Main execution function
 */
async function main() {
  console.log(
    "🚀 Starting Home Assistant type generation and post-processing...",
  );

  const hassToken = await resolveHassToken();
  if (
    hassToken === undefined ||
    hassToken === "" ||
    isPlaceholderToken(hassToken)
  ) {
    console.log("⚠️  Skipping type generation: HASS_TOKEN is not set.");
    console.log(
      "   Set HASS_TOKEN in the environment or a local .env file to enable type generation.",
    );
    return;
  }

  // Step 1: Generate types
  await generateTypes();

  // Step 2: Add TypeScript disable comments to generated files
  await addTsDisableComments();

  // Step 3: Post-process generated files
  await postProcessRegistry();
  await postProcessServices();

  // Step 4: Validate processing
  await validateProcessing();

  console.log("🎉 Type generation and post-processing completed successfully!");
}

// Execute if run directly
if (import.meta.main) {
  try {
    await main();
  } catch (error: unknown) {
    console.error("❌ Script failed:", error);
    process.exit(1);
  }
}
