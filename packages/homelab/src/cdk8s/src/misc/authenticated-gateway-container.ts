import { Size } from "cdk8s";
import { Cpu, type ContainerProps } from "cdk8s-plus-31";
import { restrictedContainer } from "./common.ts";

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
    securityContext: restrictedContainer(user, group),
  };
}
