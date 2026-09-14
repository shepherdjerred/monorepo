import { Capability, Cpu } from "cdk8s-plus-31";
import { Size } from "cdk8s";

export const NET_ADMIN_FIREWALL_RESOURCES = {
  cpu: { request: Cpu.millis(10), limit: Cpu.millis(100) },
  memory: {
    request: Size.mebibytes(16),
    limit: Size.mebibytes(64),
  },
};

export function netAdminFirewallSecurityContext(
  readOnlyRootFilesystem: boolean,
) {
  return {
    user: 0,
    group: 0,
    ensureNonRoot: false,
    privileged: false,
    allowPrivilegeEscalation: false,
    readOnlyRootFilesystem,
    capabilities: {
      drop: [Capability.ALL],
      add: [Capability.NET_ADMIN],
    },
  };
}
