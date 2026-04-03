/**
 * Homelab operation helper functions (cdk8s synth, HA type generation).
 *
 * These are plain functions (not decorated) — the @func() wrappers live in index.ts.
 */
import { dag, Container, Directory, File, Secret } from "@dagger.io/dagger";

import { BUN_IMAGE, ESLINT_CACHE } from "./constants";

import { bunBaseContainer } from "./base";

/** Run cdk8s synth (bun run build) and return the output directory. */
export function homelabSynthHelper(
  pkgDir: Directory,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  tsconfig: File | null = null,
): Directory {
  return bunBaseContainer(
    pkgDir,
    "homelab/src/cdk8s",
    depNames,
    depDirs,
    tsconfig,
  )
    .withExec(["bun", "run", "build"])
    .directory("/workspace/packages/homelab/src/cdk8s/dist");
}

/** Generate Home Assistant entity types by introspecting a live HA instance. */
export function haGenerateHelper(
  pkgDir: Directory,
  hassToken: Secret,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  tsconfig: File | null = null,
  homelabTsconfig: File | null = null,
  hassBaseUrl: string = "https://homeassistant.sjer.red",
): Directory {
  let container = bunBaseContainer(
    pkgDir,
    "homelab/src/ha",
    depNames,
    depDirs,
    tsconfig,
    ["nodejs", "npm"],
  );

  // HA tsconfig extends ../../tsconfig.base.json (homelab level);
  // pkgDir only contains src/ha, so mount the parent tsconfig too.
  if (homelabTsconfig != null) {
    container = container.withFile(
      "/workspace/packages/homelab/tsconfig.base.json",
      homelabTsconfig,
    );
  }

  return container
    .withSecretVariable("HASS_TOKEN", hassToken)
    .withEnvVariable("HASS_BASE_URL", hassBaseUrl)
    .withExec(["bun", "run", "generate-types"])
    .directory("/workspace");
}

/** Generate HA types then lint homelab/src/ha. */
export function haLintHelper(
  pkgDir: Directory,
  hassToken: Secret,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  tsconfig: File | null = null,
  homelabTsconfig: File | null = null,
): Container {
  const generated = haGenerateHelper(
    pkgDir,
    hassToken,
    depNames,
    depDirs,
    tsconfig,
    homelabTsconfig,
  );
  return dag
    .container()
    .from(BUN_IMAGE)
    .withWorkdir("/workspace/packages/homelab/src/ha")
    .withDirectory("/workspace", generated)
    .withMountedCache(
      "/workspace/packages/homelab/src/ha/.eslintcache",
      dag.cacheVolume(ESLINT_CACHE),
    )
    .withExec(["bun", "run", "lint"]);
}

/** Generate HA types then typecheck homelab/src/ha. */
export function haTypecheckHelper(
  pkgDir: Directory,
  hassToken: Secret,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  tsconfig: File | null = null,
  homelabTsconfig: File | null = null,
): Container {
  const generated = haGenerateHelper(
    pkgDir,
    hassToken,
    depNames,
    depDirs,
    tsconfig,
    homelabTsconfig,
  );
  return dag
    .container()
    .from(BUN_IMAGE)
    .withWorkdir("/workspace/packages/homelab/src/ha")
    .withDirectory("/workspace", generated)
    .withExec(["bun", "run", "typecheck"]);
}
