import type { EnvValue } from "cdk8s-plus-31";
import { flagsEnv } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";

export function temporalFeatureFlagEnvironment(): Record<string, EnvValue> {
  return flagsEnv({ deployment: "temporal/prod" });
}
