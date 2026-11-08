import type { Database } from "#infrastructure/database.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { grantTestRequesterAccess } from "#testing/authority.ts";
import { DefaultCommandV2Schema } from "#shared/editions/commands.ts";

export async function commandFixture(
  db: Database,
  role: "owner" | "member" = "member",
) {
  const actor = await db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Command requester",
      role,
    },
  });
  await grantTestRequesterAccess(db, actor.id, "command-server");
  const media = await db.mediaItem.create({
    data: {
      kind: "movie",
      title: "Scoped command fixture",
      externalIds: { plexSectionId: "1" },
    },
  });
  const service = new PrismaMediaApplication(db, {
    keepDays: 30,
    serverMachineId: "command-server",
    visibilitySections: { movie: "1", series: "2" },
  });
  async function command(
    action: unknown,
    expected?: { mediaVersion: number; targetVersion: number | null },
  ) {
    const context =
      expected === undefined
        ? await service.getDefaultCommandContext(actor, media.id)
        : null;
    return DefaultCommandV2Schema.parse({
      schemaVersion: 2,
      scope: { mediaId: media.id, edition: "default" },
      expected: expected ?? context?.expected,
      command: action,
    });
  }
  return { actor, media, service, command };
}
