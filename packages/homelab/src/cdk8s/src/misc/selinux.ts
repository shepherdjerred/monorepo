import { ApiObject, JsonPatch } from "cdk8s";
import type { Deployment } from "cdk8s-plus-31";
import { z } from "zod";

export const zfsVolumeSelinuxLevels = {
  clickhouse: "s0:c101,c201",
  scoutBeta: "s0:c220,c221",
  scoutProd: "s0:c222,c223",
} as const;

export type ZfsVolumeSelinuxLevel =
  (typeof zfsVolumeSelinuxLevels)[keyof typeof zfsVolumeSelinuxLevels];

const DeploymentSecurityContextSchema = z.looseObject({
  metadata: z.looseObject({
    name: z.string(),
  }),
  spec: z.looseObject({
    template: z.looseObject({
      spec: z.looseObject({
        securityContext: z.looseObject({}).optional(),
      }),
    }),
  }),
});

export function applyZfsVolumeSelinuxRelabeling(
  deployment: Deployment,
  level: ZfsVolumeSelinuxLevel,
) {
  const apiObject = ApiObject.of(deployment);
  const manifest = DeploymentSecurityContextSchema.parse(apiObject.toJson());

  if (manifest.spec.template.spec.securityContext === undefined) {
    throw new Error(
      `Deployment ${manifest.metadata.name} must define pod securityContext before applying ZFS SELinux relabeling`,
    );
  }

  apiObject.addJsonPatch(
    JsonPatch.add("/spec/template/spec/securityContext/seLinuxOptions", {
      level,
    }),
  );
}
