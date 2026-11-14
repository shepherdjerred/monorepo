import { parseAllDocuments } from "yaml";
import { z } from "zod";

const NetworkPolicySchema = z.looseObject({
  apiVersion: z.literal("networking.k8s.io/v1"),
  kind: z.literal("NetworkPolicy"),
  metadata: z.looseObject({ namespace: z.string().optional() }),
});

/**
 * The namespaces an upstream chart's `helm template` output puts a
 * NetworkPolicy into. The render passes no `--namespace`, so an object that
 * names none, or Helm's `default` release namespace, lands in the namespace
 * its Application deploys to.
 */
export function upstreamPolicyNamespaces(
  rendered: string,
  destinationNamespace: string,
): string[] {
  const namespaces = parseAllDocuments(rendered).flatMap((document) => {
    const policy = NetworkPolicySchema.safeParse(document.toJSON());
    if (!policy.success) return [];
    const { namespace } = policy.data.metadata;
    return [
      namespace === undefined || namespace === "default"
        ? destinationNamespace
        : namespace,
    ];
  });
  return [...new Set(namespaces)].sort();
}
