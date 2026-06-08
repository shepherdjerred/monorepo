/**
 * Zod schemas for external JSON consumed by `toolkit deployed` (argocd / kubectl).
 * Schemas are loose (`.passthrough` semantics via partial) — we only validate the
 * fields we read so unrelated cluster-shape changes don't break the command.
 */
import { z } from "zod";

export const ArgoAppSchema = z.object({
  status: z
    .object({
      sync: z
        .object({
          status: z.string().optional(),
          revision: z.string().optional(),
        })
        .optional(),
      health: z
        .object({
          status: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});
export type ArgoApp = z.infer<typeof ArgoAppSchema>;

const ContainerStatusSchema = z.object({
  image: z.string().optional(),
  imageID: z.string().optional(),
  name: z.string().optional(),
});

export const PodListSchema = z.object({
  items: z.array(
    z.object({
      metadata: z
        .object({
          name: z.string().optional(),
          namespace: z.string().optional(),
        })
        .optional(),
      status: z
        .object({
          containerStatuses: z.array(ContainerStatusSchema).optional(),
        })
        .optional(),
    }),
  ),
});
export type PodList = z.infer<typeof PodListSchema>;
