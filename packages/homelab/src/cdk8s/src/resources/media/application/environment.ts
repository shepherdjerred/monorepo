import { EnvValue, type ISecret } from "cdk8s-plus-31";

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
  return {
    FEATURE_FLAGS_MODE: EnvValue.fromValue("flipt"),
    FLIPT_NAMESPACE: EnvValue.fromValue("media"),
    FLIPT_ENVIRONMENT: EnvValue.fromValue("prod"),
    FLIPT_URL: EnvValue.fromValue(
      "http://flipt-flipt-service.flipt.svc.cluster.local:8080",
    ),
  };
}
