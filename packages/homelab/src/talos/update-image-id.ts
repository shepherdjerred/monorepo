#!/usr/bin/env bun

import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const schematicFile = join(scriptDir, "image.yaml");
const patchFile = join(scriptDir, "patches/image.yaml");
const readmeFile = join(scriptDir, "../../README.md");

async function main() {
  // Get new schematic ID from Image Factory
  console.log("Submitting schematic to Image Factory...");
  const schematic = readFileSync(schematicFile, "utf-8");

  const response = await fetch("https://factory.talos.dev/schematics", {
    method: "POST",
    body: schematic,
  });

  if (!response.ok) {
    console.error(`Error: Image Factory returned ${response.status}`);
    process.exit(1);
  }

  const { id: newId } = (await response.json()) as { id: string };
  console.log(`New schematic ID: ${newId}`);

  // Extract old ID from patches/image.yaml
  const patchContent = readFileSync(patchFile, "utf-8");
  const oldIdMatch = patchContent.match(/metal-installer-secureboot\/([a-f0-9]+)/);

  if (!oldIdMatch) {
    console.error(`Error: Could not find existing image ID in ${patchFile}`);
    process.exit(1);
  }

  const oldId = oldIdMatch[1];

  if (oldId === newId) {
    console.log("Image ID unchanged, nothing to update");
    process.exit(0);
  }

  console.log(`Old schematic ID: ${oldId}`);
  console.log("Updating files...");

  // Update patches/image.yaml
  const newPatchContent = patchContent.replaceAll(oldId, newId);
  writeFileSync(patchFile, newPatchContent);
  console.log(`  Updated: ${patchFile}`);

  // Update README.md
  const readmeContent = readFileSync(readmeFile, "utf-8");
  const newReadmeContent = readmeContent.replaceAll(oldId, newId);
  writeFileSync(readmeFile, newReadmeContent);
  console.log(`  Updated: ${readmeFile}`);

  console.log(`Done! New image ID: ${newId}`);
}

main();
