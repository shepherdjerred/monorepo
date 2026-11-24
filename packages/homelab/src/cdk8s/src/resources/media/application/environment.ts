import type { EnvValue } from "cdk8s-plus-31";
import { tailnetService } from "homelab/src/platform-model.ts";
import { flagsEnv } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";

export const MEDIA_APPLICATION_LABEL = "media.sjer.red/application";
export const MEDIA_PUBLIC_ORIGIN = tailnetService("media").origin;

export function mediaFeatureFlagEnvironment(): Record<string, EnvValue> {
  return flagsEnv({ deployment: "media/prod" });
}
