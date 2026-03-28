/**
 * Fail-fast catalog validation.
 *
 * Runs at pipeline generation time to catch catalog drift before
 * producing a pipeline that silently skips work.
 */
import { readdir } from "node:fs/promises";
import { execSync } from "node:child_process";

function getRepoRoot(): string {
  return execSync("git rev-parse --show-toplevel", {
    encoding: "utf-8",
  }).trim();
}
import {
  ALL_PACKAGES,
  IMAGE_PUSH_TARGETS,
  INFRA_PUSH_TARGETS,
  PACKAGES_WITH_IMAGES,
  DEPLOY_SITES,
  PACKAGE_TO_SITE,
  SKIP_PACKAGES,
} from "../catalog.ts";

export async function validateCatalog(): Promise<void> {
  const errors: string[] = [];

  // 1. Every packages/* directory must be in ALL_PACKAGES
  // Pipeline generator may run from scripts/ci/ or repo root — use git to find root
  const repoRoot = await getRepoRoot();
  const packageDirs = await readdir(`${repoRoot}/packages`, {
    withFileTypes: true,
  });
  const actualPackages = packageDirs
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const catalogSet = new Set(ALL_PACKAGES);
  for (const dir of actualPackages) {
    if (!catalogSet.has(dir)) {
      errors.push(
        `packages/${dir}/ exists but is not in ALL_PACKAGES. Add it to catalog.ts.`,
      );
    }
  }

  // 2. Every ALL_PACKAGES entry must have a corresponding packages/ directory
  const actualSet = new Set(actualPackages);
  for (const pkg of ALL_PACKAGES) {
    if (!actualSet.has(pkg)) {
      errors.push(
        `ALL_PACKAGES contains "${pkg}" but packages/${pkg}/ does not exist. Remove it from catalog.ts.`,
      );
    }
  }

  // 3. PACKAGES_WITH_IMAGES entries must exist in ALL_PACKAGES
  for (const pkg of PACKAGES_WITH_IMAGES) {
    if (!catalogSet.has(pkg)) {
      errors.push(
        `PACKAGES_WITH_IMAGES contains "${pkg}" but it's not in ALL_PACKAGES.`,
      );
    }
  }

  // 4. Every IMAGE_PUSH_TARGETS name should map to a PACKAGES_WITH_IMAGES entry or have neededPackages
  //    (This catches the better-skill-capped vs better-skill-capped-fetcher drift)
  for (const img of [...IMAGE_PUSH_TARGETS, ...INFRA_PUSH_TARGETS]) {
    const resolvedPkg = img.package ?? img.name;
    if (!catalogSet.has(resolvedPkg) && !img.neededPackages?.length) {
      // Image target doesn't map to any package and has no neededPackages
      // This means change detection can't trigger it
      errors.push(
        `IMAGE_PUSH_TARGETS entry "${img.name}" doesn't match any ALL_PACKAGES entry (package="${resolvedPkg}") and has no neededPackages.`,
      );
    }
  }

  // 5. PACKAGE_TO_SITE keys must exist in ALL_PACKAGES
  for (const pkg of Object.keys(PACKAGE_TO_SITE)) {
    if (!catalogSet.has(pkg)) {
      errors.push(
        `PACKAGE_TO_SITE contains key "${pkg}" but it's not in ALL_PACKAGES.`,
      );
    }
  }

  // 6. PACKAGE_TO_SITE values must match a DEPLOY_SITES bucket
  const siteBuckets = new Set(DEPLOY_SITES.map((s) => s.bucket));
  for (const [pkg, bucket] of Object.entries(PACKAGE_TO_SITE)) {
    if (!siteBuckets.has(bucket)) {
      errors.push(
        `PACKAGE_TO_SITE maps "${pkg}" to bucket "${bucket}" but no DEPLOY_SITES entry has that bucket.`,
      );
    }
  }

  // 7. SKIP_PACKAGES entries must exist in ALL_PACKAGES
  for (const pkg of SKIP_PACKAGES) {
    if (!catalogSet.has(pkg)) {
      errors.push(
        `SKIP_PACKAGES contains "${pkg}" but it's not in ALL_PACKAGES.`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Catalog validation failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
    );
  }

  console.error(
    `Catalog validated: ${ALL_PACKAGES.length} packages, ${PACKAGES_WITH_IMAGES.size} with images, ${Object.keys(PACKAGE_TO_SITE).length} with sites`,
  );
}
