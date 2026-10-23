import { z } from "zod";
import {
  deleteArgoApplication,
  getArgoApplication,
} from "#lib/delivery/argo-client.ts";
import { deliveryRequest } from "#lib/delivery/client.ts";

const RemovalsSchema = z.object({
  removals: z.array(
    z.object({
      environmentId: z.string().min(1),
      applications: z.array(
        z.object({
          name: z.string().min(1),
          lifecycle: z.enum(["retain", "cascade"]),
        }),
      ),
    }),
  ),
});
const DeletingSchema = z.object({
  metadata: z.object({ deletionTimestamp: z.string().optional() }).loose(),
});

export type RemovalEffects = {
  request: typeof deliveryRequest;
  read: (name: string) => Promise<unknown>;
  remove: (
    name: string,
    input: { environmentId: string; cascade: boolean },
  ) => Promise<unknown>;
};
const LIVE: RemovalEffects = {
  request: deliveryRequest,
  read: async (name) => await getArgoApplication(name),
  remove: async (name, input) => await deleteArgoApplication(name, input),
};

/**
 * Destroys the target state of removed environments (4.10): each owned
 * Application is deleted by its recipe's lifecycle (cascade removes its
 * resources, retain orphans them), and removal is recorded once every one
 * is gone. A deletion in progress is observed again next tick.
 */
export async function removeDeliveryTargets(effects?: RemovalEffects) {
  const { request, read, remove } = effects ?? LIVE;
  const { removals } = await request("removals", RemovalsSchema);
  let removed = 0;
  for (const removal of removals) {
    let remaining = 0;
    for (const application of removal.applications) {
      const current = await read(application.name);
      if (current === null) continue;
      remaining += 1;
      if (
        DeletingSchema.parse(current).metadata.deletionTimestamp !== undefined
      )
        continue;
      await remove(application.name, {
        environmentId: removal.environmentId,
        cascade: application.lifecycle === "cascade",
      });
    }
    if (remaining > 0) continue;
    await request(
      `environments/${encodeURIComponent(removal.environmentId)}/removed`,
      z.unknown(),
      {
        observedAt: new Date().toISOString(),
        applications: removal.applications.map((entry) => entry.name),
      },
    );
    removed += 1;
  }
  return { removed };
}
