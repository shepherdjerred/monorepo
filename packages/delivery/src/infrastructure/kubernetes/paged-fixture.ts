import {
  KUBERNETES_RESPONSE_BOUND,
  KubernetesReadBoundError,
} from "./projected-identity.ts";
import type { KubernetesRead } from "./projected-reader.ts";

/**
 * A worker Deployment the size the API server really returns one: about
 * 13 KiB, most of it the last-applied annotation and managed fields.
 */
export function retainedDeployment(index: number): Record<string, unknown> {
  const name = `temporal-delivery-wf-retained-${index.toString(16).padStart(12, "0")}`;
  return {
    metadata: {
      name,
      namespace: "temporal",
      annotations: {
        "kubectl.kubernetes.io/last-applied-configuration": "x".repeat(8000),
      },
      managedFields: [{ manager: "argocd", fieldsV1: "f".repeat(4500) }],
    },
    spec: { replicas: 0 },
    status: { observedGeneration: index },
  };
}

/**
 * A Kubernetes API for collections of fixed objects that honours `limit` and
 * `continue` and refuses, as the projected identity does, any response over
 * the bound. Records each request it served.
 */
export function pagedKubernetes(
  collections: Record<string, readonly Record<string, unknown>[]>,
  bound: number = KUBERNETES_RESPONSE_BOUND,
): { read: KubernetesRead; requests: string[] } {
  const requests: string[] = [];
  return {
    requests,
    read: (path) => {
      requests.push(path);
      const url = new URL(path, "https://kubernetes.invalid");
      const objects = collections[`${url.pathname}${selector(url)}`];
      if (objects === undefined)
        return Promise.reject(new Error(`Unexpected read ${path}`));
      const start = Number(url.searchParams.get("continue") ?? "0");
      const limit = Number(url.searchParams.get("limit") ?? objects.length);
      const end = Math.min(start + limit, objects.length);
      const body = {
        metadata: end < objects.length ? { continue: String(end) } : {},
        items: objects.slice(start, end),
      };
      const size = Buffer.byteLength(JSON.stringify(body));
      return size > bound
        ? Promise.reject(new KubernetesReadBoundError(path, bound, size))
        : Promise.resolve(structuredClone(body));
    },
  };
}

function selector(url: URL): string {
  const labels = url.searchParams.get("labelSelector");
  return labels === null ? "" : `?labelSelector=${labels}`;
}
