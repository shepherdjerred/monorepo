import { Size } from "cdk8s";
import { type ContainerProps, Cpu } from "cdk8s-plus-31";
import { withCommonProps } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

/**
 * A container that runs one bash script against the Kubernetes API with the
 * catalog's digest-pinned kubectl image.
 *
 * Shared by the ArgoCD hook Jobs that gate a sync on cluster state, so the
 * image pin, the non-root read-only sandbox (the image's own uid 1001) and the
 * small fixed footprint are one decision rather than a copy per gate. The Job
 * still has to mount a ServiceAccount token and bind it the RBAC the script
 * needs; this only describes the container.
 */
export function kubectlScriptContainer(
  name: string,
  script: string,
): ContainerProps {
  return withCommonProps({
    name,
    image: `bitnamilegacy/kubectl:${versions["bitnamilegacy/kubectl"]}`,
    command: ["/bin/bash", "-c"],
    args: [script],
    securityContext: {
      user: 1001,
      group: 1001,
      ensureNonRoot: true,
      readOnlyRootFilesystem: true,
    },
    resources: {
      cpu: { request: Cpu.millis(10), limit: Cpu.millis(100) },
      memory: { request: Size.mebibytes(32), limit: Size.mebibytes(128) },
    },
  });
}
