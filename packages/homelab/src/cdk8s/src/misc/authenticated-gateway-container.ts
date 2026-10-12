import { Size } from "cdk8s";
import {
  Capability,
  Cpu,
  SeccompProfileType,
  type ContainerProps,
} from "cdk8s-plus-31";

type AuthenticatedGatewayContainerDefaults = Pick<
  ContainerProps,
  "resources" | "securityContext"
>;

/** Shared least-privilege defaults for the in-pod Caddy auth gateways. */
export function authenticatedGatewayContainerDefaults(
  user = 1000,
  group = 1000,
): AuthenticatedGatewayContainerDefaults {
  return {
    resources: {
      cpu: { request: Cpu.millis(5), limit: Cpu.millis(100) },
      memory: { request: Size.mebibytes(16), limit: Size.mebibytes(64) },
    },
    securityContext: {
      user,
      group,
      ensureNonRoot: true,
      readOnlyRootFilesystem: true,
      allowPrivilegeEscalation: false,
      privileged: false,
      capabilities: { drop: [Capability.ALL] },
      seccompProfile: { type: SeccompProfileType.RUNTIME_DEFAULT },
    },
  };
}
