import type { MediaActor } from "#application/auth.ts";
import type { Database } from "#infrastructure/database.ts";
import { PrismaLibraryApplication } from "#infrastructure/library/views/library.ts";
import { libraryMember } from "#infrastructure/library/views/library.test-support.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { RequestInterestCommands } from "#infrastructure/request-interest/commands.ts";
import { grantTestLease } from "#testing/authority.ts";

const settings = {
  serverMachineId: "fixture-server",
  sections: { movie: "1", series: "2" },
};

/** The title read, the library list and the interest commands over one database. */
export function titleApplications(db: Database) {
  return {
    media: new PrismaMediaApplication(db, {
      keepDays: 30,
      serverMachineId: settings.serverMachineId,
      movieSectionId: settings.sections.movie,
      visibilitySections: settings.sections,
    }),
    library: new PrismaLibraryApplication(db, settings),
    interests: new RequestInterestCommands(db, { keepDays: 30 }),
  };
}

/** A household member with current Plex access and a name of their own. */
export async function namedMember(
  db: Database,
  displayName: string,
  role: "owner" | "member" = "member",
): Promise<MediaActor> {
  const actor = await libraryMember(db, { sections: ["1", "2"], role });
  await db.mediaUser.update({
    where: { id: actor.id },
    data: { displayName },
  });
  return { ...actor, displayName };
}

export async function titleHousehold(db: Database) {
  return {
    owner: await namedMember(db, "Olive", "owner"),
    member: await namedMember(db, "Mei"),
    housemate: await namedMember(db, "Sam"),
  };
}

/** Commands, unlike reads, need a household that is running. */
export async function runningHousehold(db: Database) {
  await grantTestLease(db);
  await db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { mode: "active", ownershipConfirmed: true, recoveryEpoch: 0 },
  });
}

/** Who a reader is told follows a title; null when the names are withheld. */
export async function followersOf(
  media: ReturnType<typeof titleApplications>["media"],
  actor: MediaActor,
  mediaId: string,
) {
  const detail = await media.getMedia(actor, mediaId);
  return detail.followers;
}
