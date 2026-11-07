import { resolveCredentialValues } from "#lib/credentials.ts";
import type { CredentialDeps } from "#lib/credentials.ts";

/**
 * `toolkit kube credential`: the client-go exec credential plugin named by the
 * workstation kubeconfig. kubectl, helm, k9s, and client-node call it and get
 * the homelab admin client certificate as a v1 ExecCredential, so the
 * kubeconfig on disk holds only the endpoint and CA.
 *
 * It refuses to run unless client-go invoked it (KUBERNETES_EXEC_INFO is set),
 * so an agent debugging auth cannot print the admin key into a transcript.
 */

export const EXEC_CREDENTIAL_LIFETIME_MS = 60 * 60 * 1000;

function pem(name: string, base64: string): string {
  const decoded = Buffer.from(base64, "base64").toString("utf8");
  if (!decoded.startsWith("-----BEGIN ")) {
    throw new Error(`toolkit: ${name} is not base64-encoded PEM`);
  }
  return decoded;
}

export function execCredential(
  material: { readonly certificate: string; readonly key: string },
  now: Date,
): string {
  return JSON.stringify({
    apiVersion: "client.authentication.k8s.io/v1",
    kind: "ExecCredential",
    status: {
      clientCertificateData: pem(
        "KUBE_CLIENT_CERTIFICATE_DATA",
        material.certificate,
      ),
      clientKeyData: pem("KUBE_CLIENT_KEY_DATA", material.key),
      expirationTimestamp: new Date(
        now.getTime() + EXEC_CREDENTIAL_LIFETIME_MS,
      ).toISOString(),
    },
  });
}

export async function runKubeCredential(
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
  deps?: CredentialDeps,
): Promise<number> {
  if (args.length > 0) {
    console.error("Usage: toolkit kube credential");
    return 2;
  }
  const execInfo = environment["KUBERNETES_EXEC_INFO"];
  if (execInfo === undefined || execInfo.length === 0) {
    console.error(
      "toolkit: `kube credential` is a kubectl exec plugin and prints the admin key; it only runs when client-go sets KUBERNETES_EXEC_INFO. Use kubectl instead.",
    );
    return 2;
  }
  const values = await resolveCredentialValues(
    ["KUBE_CLIENT_CERTIFICATE_DATA", "KUBE_CLIENT_KEY_DATA"],
    deps,
  );
  console.log(
    execCredential(
      {
        certificate: values["KUBE_CLIENT_CERTIFICATE_DATA"] ?? "",
        key: values["KUBE_CLIENT_KEY_DATA"] ?? "",
      },
      new Date(),
    ),
  );
  return 0;
}
