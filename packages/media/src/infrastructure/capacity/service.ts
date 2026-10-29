import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import type { Database } from "#infrastructure/database.ts";
import { loadCapacitySnapshot } from "./read.ts";
import { projectCapacity } from "./project.ts";

export class PrismaCapacityAdministration {
  constructor(
    private readonly db: Database,
    private readonly enabled: () => Promise<boolean>,
  ) {}

  async capacity(actor: MediaActor) {
    const samplingEnabled = await this.enabled();
    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "MediaUser" WHERE id=${actor.id} FOR SHARE`;
        const user = await tx.mediaUser.findUnique({ where: { id: actor.id } });
        if (user?.role !== "owner" || user.restricted)
          throw new MediaError(
            "owner_required",
            "Unrestricted owner access is required",
            403,
          );
        return projectCapacity(await loadCapacitySnapshot(tx), {
          samplingEnabled,
          now: new Date(),
        });
      },
      { isolationLevel: "RepeatableRead" },
    );
  }
}
export type CapacityAdministration = Pick<
  PrismaCapacityAdministration,
  "capacity"
>;
