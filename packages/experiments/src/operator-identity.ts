import { authenticate } from "@shepherdjerred/flags/auth.ts";
import { createTrustedTailscaleProxyAddresses } from "@shepherdjerred/flags/ingress-proxy.ts";

export type OperatorVerification =
  { login: string } | { status: 401 | 403 | 503; error: string };

export type OperatorVerifier = (
  request: Request,
  peerAddress: string | null,
) => Promise<OperatorVerification>;

type OperatorConfiguration = {
  ingressNamespace: string;
  ingressName: string;
  serviceName: string;
  port: number;
  host: string;
  identityDirectory: string;
  operatorLogins: readonly string[];
  publicOrigin: string;
};

export function createOperatorVerifier(
  config: OperatorConfiguration,
): OperatorVerifier {
  const trustedProxyAddresses = createTrustedTailscaleProxyAddresses({
    namespace: config.ingressNamespace,
    name: config.ingressName,
    proxyNamespace: "tailscale",
    serviceName: config.serviceName,
    port: config.port,
    host: config.host,
    directory: config.identityDirectory,
    parentLabels: {
      "tailscale.com/managed": "true",
      "tailscale.com/parent-resource-type": "ingress",
      "tailscale.com/parent-resource-ns": config.ingressNamespace,
      "tailscale.com/parent-resource": config.ingressName,
    },
  });

  return async (request, peerAddress) => {
    const result = await authenticate(request, peerAddress, {
      machineToken: undefined,
      operatorLogins: config.operatorLogins,
      trustedProxyAddresses,
      publicOrigin: config.publicOrigin,
    });
    if ("status" in result) return result;
    return result.kind === "human"
      ? { login: result.login }
      : { status: 401, error: "Authenticated operator required" };
  };
}
