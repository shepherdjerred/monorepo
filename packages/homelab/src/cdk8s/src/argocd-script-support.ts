import { z } from "zod";

const SyncInfoEntrySchema = z.discriminatedUnion("name", [
  z.object({
    name: z.literal("ci.sjer.red/request-id"),
    value: z.uuid(),
  }),
  z.object({
    name: z.literal("ci.sjer.red/operation-id"),
    value: z.uuid(),
  }),
  z.object({
    name: z.literal("ci.sjer.red/revision"),
    value: z.string(),
  }),
  z.object({
    name: z.literal("ci.sjer.red/release-phase"),
    value: z.enum(["stage", "batch", "prune", "child"]),
  }),
]);

export const SyncRequestSchema = z.object({
  infos: z.array(SyncInfoEntrySchema),
  manifests: z.array(z.string()).optional(),
  revision: z.string().optional(),
  resources: z.array(
    z.object({
      group: z.string(),
      kind: z.string(),
      name: z.string(),
    }),
  ),
});

export const RootSyncRequestSchema = z.object({
  infos: z.array(SyncInfoEntrySchema),
  prune: z.boolean(),
  revision: z.string().optional(),
});

export function operationForRootSyncRequest(
  request: unknown,
): Record<string, unknown> {
  const syncRequest = RootSyncRequestSchema.parse(request);
  return {
    info: syncRequest.infos,
    initiatedBy: { username: "buildkite" },
    sync: {
      prune: syncRequest.prune,
      ...(syncRequest.revision === undefined
        ? {}
        : { revision: syncRequest.revision }),
    },
  };
}

export function operationResponseForRootSync(request: unknown): unknown {
  return { operation: operationForRootSyncRequest(request) };
}

export function operationForSyncRequest(
  request: unknown,
): Record<string, unknown> {
  const syncRequest = SyncRequestSchema.parse(request);
  return {
    info: syncRequest.infos,
    initiatedBy: { username: "buildkite" },
    sync: {
      ...(syncRequest.manifests === undefined
        ? {}
        : { manifests: syncRequest.manifests }),
      resources: syncRequest.resources,
    },
  };
}

export type SyncRequest = z.infer<typeof SyncRequestSchema>;

/** A resource the requested revision introduces, absent from `managed-resources`. */
export type IntroducedResource = {
  readonly apiVersion: string;
  readonly kind: string;
  readonly name: string;
  readonly namespace: string;
};

const DEFAULT_INTRODUCED_RESOURCE: IntroducedResource = {
  apiVersion: "batch/v1",
  kind: "Job",
  name: "index-init",
  namespace: "worker",
};

/**
 * Fake ArgoCD for the apply-safety preflight's introduced-resource lookup.
 *
 * The requested revision declares one resource that `managed-resources` does
 * not know about, so the preflight reads its live state directly and the caller
 * chooses what the resource endpoint answers. Lives here rather than in a test
 * file so the contract tests and the sync-managed tests drive one shared fake —
 * the bug this covers survived precisely because separate fakes each encoded
 * the same wrong belief about that endpoint.
 */
export function serveIntroducedResourceLookup(options: {
  readonly response: { readonly status: number; readonly body: unknown };
  readonly resource?: IntroducedResource;
}) {
  const resource = options.resource ?? DEFAULT_INTRODUCED_RESOURCE;
  let syncPosts = 0;
  const resourceQueries: string[] = [];
  let requestedOperation: Record<string, unknown> | undefined;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/applications/worker" &&
        url.searchParams.get("refresh") === "hard"
      ) {
        return Response.json({ status: {} });
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/applications/worker/managed-resources"
      ) {
        return Response.json({ items: [] });
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/applications/worker/manifests"
      ) {
        return Response.json({
          manifests: [
            JSON.stringify({
              apiVersion: resource.apiVersion,
              kind: resource.kind,
              metadata: { name: resource.name, namespace: resource.namespace },
              spec: { template: { spec: { containers: [] } } },
            }),
          ],
        });
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/applications/worker/resource"
      ) {
        resourceQueries.push(url.search);
        return Response.json(options.response.body, {
          status: options.response.status,
        });
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/v1/applications/worker/sync"
      ) {
        syncPosts += 1;
        requestedOperation = operationForRootSyncRequest(await request.json());
        return Response.json({ operation: requestedOperation });
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/applications/worker"
      ) {
        return Response.json({
          status: {
            sync: { revision: "2.0.0-43", status: "Synced" },
            health: { status: "Healthy" },
            operationState: {
              phase: "Succeeded",
              startedAt: new Date().toISOString(),
              operation: requestedOperation,
            },
          },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { server, syncPosts: () => syncPosts, resourceQueries };
}
