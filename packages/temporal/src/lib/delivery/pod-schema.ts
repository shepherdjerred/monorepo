import { z } from "zod";

/** Native runtime proof shared by selected app roles and original retained Workflow hosts. */
export const DeliveryPodSchema = z.object({
  metadata: z.object({
    labels: z.record(z.string(), z.string()).default({}),
    deletionTimestamp: z.string().optional(),
    ownerReferences: z.array(z.object({ kind: z.string() })).optional(),
  }),
  spec: z.object({
    containers: z.array(z.object({ name: z.string(), image: z.string() })),
  }),
  status: z.object({
    phase: z.string(),
    containerStatuses: z
      .array(
        z.object({
          name: z.string(),
          ready: z.boolean(),
          imageID: z.string(),
          state: z.object({ running: z.unknown().optional() }),
        }),
      )
      .default([]),
  }),
});
