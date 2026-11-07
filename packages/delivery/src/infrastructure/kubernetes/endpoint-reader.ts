import { z } from "zod";
import { DELIVERY_KUBERNETES_READERS } from "@shepherdjerred/ops-model/delivery-readers.ts";
import { projectedReader, type KubernetesRead } from "./projected-reader.ts";

const EndpointSliceListSchema = z.object({
  items: z.array(
    z.object({
      endpoints: z
        .array(
          z.object({
            conditions: z.object({ ready: z.boolean().optional() }).optional(),
            targetRef: z.object({ name: z.string() }).optional(),
          }),
        )
        .nullish(),
    }),
  ),
});

const SERVICE_SLICES = `/apis/discovery.k8s.io/v1/namespaces/delivery/endpointslices?labelSelector=${encodeURIComponent(
  "kubernetes.io/service-name=delivery",
)}`;

/**
 * Whether proxies have stopped routing new connections to `podName`: its
 * endpoint in the `delivery` Service is not ready or gone, and another ready
 * endpoint has taken the traffic. A failed read is not that evidence.
 */
export function createEndpointDrainObserver(
  podName: string,
  read?: KubernetesRead,
): () => Promise<boolean> {
  const slices = projectedReader(
    DELIVERY_KUBERNETES_READERS.endpointDrain,
    read,
  );
  return async () => {
    const endpoints = EndpointSliceListSchema.parse(
      await slices(SERVICE_SLICES),
    ).items.flatMap((slice) => slice.endpoints ?? []);
    const own = endpoints.filter(
      (endpoint) => endpoint.targetRef?.name === podName,
    );
    const others = endpoints.filter(
      (endpoint) =>
        endpoint.targetRef?.name !== podName &&
        endpoint.conditions?.ready === true,
    );
    return (
      others.length > 0 &&
      own.every((endpoint) => endpoint.conditions?.ready === false)
    );
  };
}
