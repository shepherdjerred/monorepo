import { Size } from "cdk8s";
import { Capability, Cpu } from "cdk8s-plus-31";

/** Keep both edge owners on the same resource and privilege policy during migration. */
export function caddyEdgeContainerDefaults() {
  return {
    resources: {
      cpu: { request: Cpu.millis(50), limit: Cpu.millis(1000) },
      memory: { request: Size.mebibytes(64), limit: Size.mebibytes(256) },
    },
    securityContext: {
      user: 1000,
      group: 1000,
      ensureNonRoot: true,
      readOnlyRootFilesystem: true,
      allowPrivilegeEscalation: false,
      capabilities: { drop: [Capability.ALL] },
    },
  };
}
