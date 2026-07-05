import { ApiObject, JsonPatch } from "cdk8s";
import type { Deployment } from "cdk8s-plus-31";

export function applyZfsVolumeSelinuxRelabeling(
  deployment: Deployment,
  level: string,
) {
  ApiObject.of(deployment).addJsonPatch(
    JsonPatch.add("/spec/template/spec/securityContext/seLinuxOptions", {
      level,
    }),
  );
}
