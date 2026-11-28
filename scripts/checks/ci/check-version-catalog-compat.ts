#!/usr/bin/env bun
/**
 * Guard against removing version-catalog entries still read by the deployed
 * woodpecker-config-extension (`origin/main`).
 *
 * `woodpecker-config-extension` runs from the live deployed container image on
 * `origin/main`, while fetching `packages/version-catalog/src/catalog.json` at
 * the PR head commit. Removing an image reference from `src/images.ts` and
 * deleting its `catalog.json` entry in a single PR causes `/ciconfig` to fail
 * with HTTP 500 before any pipeline workflows are created.
 */
import path from "node:path";
import { z } from "zod";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
export const IMAGES_SOURCE_PATH =
  "packages/woodpecker-config-extension/src/images.ts";
export const VERSION_CATALOG_PATH = "packages/version-catalog/src/catalog.json";

const CatalogSchema = z.looseObject({
  entries: z.array(z.looseObject({ name: z.string(), value: z.string() })),
});

/**
 * Extract every version-catalog image name referenced by a revision of
 * `packages/woodpecker-config-extension/src/images.ts`.
 *
 * Supports both `CATALOG_IMAGE_NAMES = [...]` and the legacy
 * `type CatalogImageName = ...` / `reference(catalog, "...")` forms so commits
 * before and after `CATALOG_IMAGE_NAMES` was introduced are parsed identically.
 */
function addQuotedLiterals(
  segment: string | undefined,
  names: Set<string>,
): void {
  if (segment === undefined) return;
  for (const literal of segment.matchAll(/"([^"]+)"/gu)) {
    if (literal[1] !== undefined) names.add(literal[1]);
  }
}

export function extractCatalogImageNames(imagesSource: string): string[] {
  const names = new Set<string>();
  const arrayMatch =
    /export\s+const\s+CATALOG_IMAGE_NAMES\s*=\s*\[([\s\S]*?)\]\s*as\s+const/u.exec(
      imagesSource,
    );
  addQuotedLiterals(arrayMatch?.[1], names);

  const unionMatch = /export\s+type\s+CatalogImageName\s*=([\s\S]*?);/u.exec(
    imagesSource,
  );
  if (unionMatch?.[1]?.includes("typeof ") !== true) {
    addQuotedLiterals(unionMatch?.[1], names);
  }

  for (const callMatch of imagesSource.matchAll(
    /\breference\(\s*catalog\s*,\s*"([^"]+)"\s*\)/gu,
  )) {
    if (callMatch[1] !== undefined) names.add(callMatch[1]);
  }

  if (names.size === 0) {
    throw new Error(
      `Could not extract any catalog image names from ${IMAGES_SOURCE_PATH}`,
    );
  }
  return [...names].toSorted();
}

export function parseCatalogEntryNames(catalogJsonText: string): Set<string> {
  const parsed = CatalogSchema.safeParse(JSON.parse(catalogJsonText));
  if (!parsed.success) {
    throw new TypeError(
      `${VERSION_CATALOG_PATH} has an unexpected shape: ${parsed.error.message}`,
    );
  }
  return new Set(
    parsed.data.entries
      .filter((entry) => entry.value.trim().length > 0)
      .map((entry) => entry.name),
  );
}

export function formatExpandContractError(
  missingNames: readonly string[],
  baseRef: string,
): string {
  const formatted = missingNames.join(", ");
  return [
    `${VERSION_CATALOG_PATH} is missing version-catalog entries still read by the deployed woodpecker-config-extension at ${baseRef}: ${formatted}`,
    "",
    "The live woodpecker-config-extension pod runs origin/main's resolveCiImages() against your PR head's catalog.json.",
    "Use a two-PR expand/contract sequence instead of deleting both in one PR:",
    `  1. PR 1 (expand/migrate): remove ${formatted} from ${IMAGES_SOURCE_PATH} while keeping the entry in ${VERSION_CATALOG_PATH}, merge, and wait for woodpecker-config-extension to deploy.`,
    `  2. PR 2 (contract): delete ${formatted} from ${VERSION_CATALOG_PATH}.`,
  ].join("\n");
}

export function resolveDefaultBaseRef(
  env: Readonly<Record<string, string | undefined>> = Bun.env,
): string {
  const fromEnv = env["CI_CHANGED_BASE"]?.trim();
  return fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : "origin/main";
}

export function readGitBlob(
  baseRef: string,
  relativePath: string,
  options: {
    cwd?: string;
    env?: Readonly<Record<string, string | undefined>>;
  } = {},
): string | undefined {
  const result = Bun.spawnSync(["git", "show", `${baseRef}:${relativePath}`], {
    cwd: options.cwd ?? REPOSITORY_ROOT,
    env: options.env ?? Bun.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  return result.exitCode === 0 ? result.stdout.toString("utf8") : undefined;
}

export type VersionCatalogCompatOptions = {
  root?: string;
  baseRef?: string;
  env?: Readonly<Record<string, string | undefined>>;
  readBaseImages?: (
    baseRef: string,
  ) => Promise<string | undefined> | string | undefined;
  readCatalog?: () => Promise<string> | string;
};

export async function checkVersionCatalogCompat(
  options: VersionCatalogCompatOptions = {},
): Promise<
  | { ok: true; checked: string[] }
  | { ok: false; message: string; missing: string[] }
> {
  const root = options.root ?? REPOSITORY_ROOT;
  const baseRef = options.baseRef ?? resolveDefaultBaseRef(options.env);
  const baseImagesSource = options.readBaseImages
    ? await options.readBaseImages(baseRef)
    : readGitBlob(baseRef, IMAGES_SOURCE_PATH, {
        cwd: root,
        ...(options.env === undefined ? {} : { env: options.env }),
      });

  if (baseImagesSource === undefined) {
    return { ok: true, checked: [] };
  }

  const requiredByDeployedExtension =
    extractCatalogImageNames(baseImagesSource);
  const catalogText = options.readCatalog
    ? await options.readCatalog()
    : await Bun.file(path.join(root, VERSION_CATALOG_PATH)).text();
  const presentEntries = parseCatalogEntryNames(catalogText);

  const missing = requiredByDeployedExtension.filter(
    (name) => !presentEntries.has(name),
  );
  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      message: formatExpandContractError(missing, baseRef),
    };
  }

  return { ok: true, checked: requiredByDeployedExtension };
}

export function parseCliBaseRef(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>> = Bun.env,
): string {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new Error("--base requires a git revision");
      }
      return value;
    }
    if (arg?.startsWith("--base=") === true) {
      const value = arg.slice("--base=".length);
      if (value.length === 0) throw new Error("--base requires a git revision");
      return value;
    }
  }
  return resolveDefaultBaseRef(env);
}

if (import.meta.main) {
  const baseRef = parseCliBaseRef(Bun.argv.slice(2));
  const outcome = await checkVersionCatalogCompat({ baseRef });
  if (!outcome.ok) {
    console.error(outcome.message);
    process.exit(1);
  }
}
