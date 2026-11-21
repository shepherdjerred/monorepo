import { EnvValue, type ISecret } from "cdk8s-plus-31";
import { tailnetService } from "homelab/src/platform-model.ts";
import { fliptEnv } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";

export const MEDIA_APPLICATION_LABEL = "media.sjer.red/application";
export const MEDIA_PUBLIC_ORIGIN = tailnetService("media").origin;

export function mediaDatabaseEnvironment(
  secret: ISecret,
): Record<string, EnvValue> {
  const password = "$(DB_" + "PASSWORD)";
  return {
    DB_USER: EnvValue.fromSecretValue({ secret, key: "username" }),
    DB_PASSWORD: EnvValue.fromSecretValue({ secret, key: "password" }),
    DATABASE_URL: EnvValue.fromValue(
      `postgresql://$(DB_USER):${password}@media-postgresql:5432/media_db`,
    ),
  };
}

export function mediaFeatureFlagEnvironment(): Record<string, EnvValue> {
  return fliptEnv({ namespace: "media", environment: "prod" });
}

/**
 * Where the API keeps the artwork it fetches from TMDB. The claim is a
 * rebuildable cache, excluded from backups, and sized above the API's cache
 * cap (3 GiB by default). The API requires the directory once it serves
 * artwork; an image from before that ignores the mount and the variable.
 */
export const MEDIA_ARTWORK_CACHE = {
  claim: "media-artwork-cache",
  gibibytes: 4,
  path: "/var/cache/media/artwork",
} as const;

export function mediaArtworkCacheEnvironment(): Record<string, EnvValue> {
  return {
    MEDIA_ARTWORK_CACHE_DIR: EnvValue.fromValue(MEDIA_ARTWORK_CACHE.path),
  };
}
