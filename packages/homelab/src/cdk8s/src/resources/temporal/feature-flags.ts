import type { EnvValue } from "cdk8s-plus-31";
import { fliptEnv } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";

export function temporalFeatureFlagEnvironment(
  environment: "beta" | "prod" = "prod",
): Record<string, EnvValue> {
  return fliptEnv({
    namespace: "temporal",
    environment,
    order: ["FLIPT_URL", "FLIPT_NAMESPACE", "FLIPT_ENVIRONMENT"],
  });
}
