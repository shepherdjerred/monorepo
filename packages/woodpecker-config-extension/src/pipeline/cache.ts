import type { StepVolume } from "#src/pipeline/model.ts";

/** Shared Bun cache claims created by the homelab manifests. */
export const BUN_CACHE = {
  claim: "woodpecker-bun-cache",
  path: "/woodpecker/bun-cache",
} as const satisfies StepVolume;

/** Separate lock storage shared with the Temporal cache collector. */
export const BUN_CACHE_CONTROL = {
  claim: "woodpecker-bun-cache-control",
  path: "/woodpecker/bun-cache-control",
} as const satisfies StepVolume;

/** UV cache claim created by the homelab manifests. */
export const UV_CACHE = {
  claim: "woodpecker-uv-cache",
  path: "/woodpecker/uv-cache",
} as const satisfies StepVolume;

/**
 * Select an install mode that coordinates with the shared cache collector.
 * The cache and its control volume are a pair: mounting only one could race
 * cache cleanup or make every install fail to acquire its lock.
 */
export function bunInstallEnvironment(
  volumes: readonly StepVolume[] | undefined,
): Readonly<Record<string, string>> {
  const uv = volumes?.find((volume) => volume.claim === UV_CACHE.claim);
  if (uv !== undefined && uv.path !== UV_CACHE.path) {
    throw new Error("UV cache volume must use its declared mount path");
  }
  const uvEnvironment = uv === undefined ? {} : { UV_CACHE_DIR: UV_CACHE.path };
  const cache = volumes?.find((volume) => volume.claim === BUN_CACHE.claim);
  const control = volumes?.find(
    (volume) => volume.claim === BUN_CACHE_CONTROL.claim,
  );

  if ((cache === undefined) !== (control === undefined)) {
    throw new Error(
      "Bun cache and cache control volumes must be mounted together",
    );
  }

  if (cache === undefined || control === undefined) {
    return { ...uvEnvironment, BUN_INSTALL_LOCK_MODE: "local" };
  }

  if (
    cache.path !== BUN_CACHE.path ||
    control.path !== BUN_CACHE_CONTROL.path
  ) {
    throw new Error("Bun cache volumes must use their declared mount paths");
  }

  return {
    ...uvEnvironment,
    BUN_INSTALL_CACHE_DIR: `${BUN_CACHE.path}/data`,
    BUN_INSTALL_LOCK_MODE: "shared",
    BUN_CACHE_LOCK_FILE: `${BUN_CACHE_CONTROL.path}/.gc.lock`,
  };
}
