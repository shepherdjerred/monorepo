import { EnvValue } from "cdk8s-plus-31";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { CI_BASE_IMAGE } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/buildkite-bun-cache.ts";

export function temporalMaintenanceEnvironment(): Record<string, EnvValue> {
  return {
    TEMPORAL_MAINTENANCE_CI_BASE_IMAGE: EnvValue.fromValue(CI_BASE_IMAGE),
    TEMPORAL_MAINTENANCE_KOMETA_IMAGE: EnvValue.fromValue(
      `docker.io/kometateam/kometa:${versions["kometateam/kometa"]}`,
    ),
    TEMPORAL_MAINTENANCE_TRIVY_IMAGE: EnvValue.fromValue(
      "aquasec/trivy:0.72.0",
    ),
  };
}
