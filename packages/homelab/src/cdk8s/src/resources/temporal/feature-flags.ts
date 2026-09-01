import { EnvValue } from "cdk8s-plus-31";

export function temporalFeatureFlagEnvironment(): Record<string, EnvValue> {
  return {
    FEATURE_FLAGS_MODE: EnvValue.fromValue("flipt"),
    FLIPT_URL: EnvValue.fromValue(
      "http://flipt-flipt-service.flipt.svc.cluster.local:8080",
    ),
    FLIPT_NAMESPACE: EnvValue.fromValue("temporal"),
    FLIPT_ENVIRONMENT: EnvValue.fromValue("prod"),
  };
}
