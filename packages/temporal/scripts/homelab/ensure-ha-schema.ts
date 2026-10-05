#!/usr/bin/env bun
/**
 * Copies the committed HA schema stub into place if a generated schema
 * doesn't exist yet. Runs before typecheck/test/build so consumers can work
 * without HA credentials. `bun run generate` replaces the file in full with
 * codegen output from the live HA instance.
 */
import { copyFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function main(): Promise<void> {
  // `fileURLToPath`, not the URL's `pathname`: on Windows that is `/C:/...`,
  // which `path.resolve` turns into `C:\C:\...`.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const generatedDir = path.resolve(here, "..", "..", "src", "generated");
  const target = path.join(generatedDir, "ha-schema.ts");
  const stub = path.join(generatedDir, "ha-schema.stub.ts");

  try {
    await stat(target);
    return;
  } catch {
    // fall through to copy
  }

  await copyFile(stub, target);
  console.warn(`ensure-ha-schema: copied stub → ${target}`);
}

void (async (): Promise<void> => {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`ensure-ha-schema: ${message}`);
    process.exit(1);
  }
})();
