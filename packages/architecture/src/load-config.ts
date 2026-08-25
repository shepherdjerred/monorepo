import { stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  type ArchitectureDefinition,
  resolveArchitecture,
} from "#src/definition.ts";

/** File a package uses to declare layer boundaries. Optional. */
const CONFIG_FILE_NAME = "architecture.config.ts";

/**
 * Absent means absent — nothing else.
 *
 * Treating any `stat` failure as "no config" would let a permissions or I/O
 * error silently downgrade a package that declares boundaries to the bare
 * `no-circular` baseline, which is precisely the vacuous-pass this harness
 * exists to prevent. Only ENOENT answers the question being asked.
 */
async function configFileExists(configPath: string): Promise<boolean> {
  try {
    await stat(configPath);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/**
 * Load a package's architecture definition.
 *
 * The config file is optional on purpose: `no-circular` is a universal rule
 * that needs no configuration, so a package opting into the baseline check
 * should not have to write a file that says nothing. A package that *does*
 * declare boundaries must have its config parse and validate — a malformed
 * config is an error, never a silent fall back to the baseline.
 */
export async function loadArchitectureDefinition(
  packageRoot: string,
): Promise<ArchitectureDefinition> {
  const configPath = path.join(packageRoot, CONFIG_FILE_NAME);
  if (!(await configFileExists(configPath))) {
    return resolveArchitecture({});
  }
  const module: unknown = await import(pathToFileURL(configPath).href);
  if (typeof module !== "object" || module === null || !("default" in module)) {
    throw new Error(`${configPath} must have a default export`);
  }
  return resolveArchitecture(module.default);
}
