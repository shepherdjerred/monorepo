import { EnvValue, type ISecret } from "cdk8s-plus-31";
import { fliptEnv } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";

export const MEDIA_APPLICATION_LABEL = "media.sjer.red/application";
export const MEDIA_PUBLIC_ORIGIN = "https://media.tailnet-1a49.ts.net";

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
