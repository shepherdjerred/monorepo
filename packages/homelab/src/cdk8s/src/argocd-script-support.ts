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
