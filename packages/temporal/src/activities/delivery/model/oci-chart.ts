import type { EvidenceInput } from "@shepherdjerred/delivery/contract";
import {
  registryLocation,
  resolveManifestDigest,
  type RegistryTransport,
} from "@shepherdjerred/delivery/oci-registry";

type OciChart = { id: string; uri: string; version: string; digest: string };

/**
 * An OCI chart's tag can move after acquisition while ArgoCD still pulls it
 * by that tag. Before any effect, the executor resolves the tag again with
 * the resolver acquisition used and refuses every manifest digest except
 * the one the selection froze.
 */
export async function verifyOciChart(
  artifact: OciChart,
  operationId: string,
  cancellation: AbortSignal,
  transport: RegistryTransport = fetch,
): Promise<EvidenceInput> {
  const reference = new URL(artifact.uri);
  const location = registryLocation(
    `https://${reference.host}`,
    reference.pathname.replace(/^\/+/u, ""),
  );
  const digest = await resolveManifestDigest(
    location,
    artifact.version,
    async (url, init) => {
      const timeout = init?.signal ?? undefined;
      return await transport(url, {
        ...init,
        signal:
          timeout === undefined
            ? cancellation
            : AbortSignal.any([cancellation, timeout]),
      });
    },
  );
  if (digest !== artifact.digest)
    throw new Error(
      `OCI chart ${artifact.uri}:${artifact.version} now resolves to ${digest}, not the immutable artifact digest ${artifact.digest}`,
    );
  return {
    kind: "preflight",
    operationId,
    summary: `Source ${artifact.id} tag ${artifact.version} still resolves to ${artifact.digest}`,
  };
}
