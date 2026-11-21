import type { MediaActor } from "#application/auth.ts";
import { MediaError, requireOwner } from "#application/errors.ts";
import type { Database } from "#infrastructure/database.ts";
import {
  ProfileDefaultsSchema,
  ProfileListSchema,
  type ProfileDefaults,
  type ProfileList,
} from "#shared/api.ts";

/** The stored role decides, not the role a signed-in session still carries. */
async function currentUser(db: Database, actor: MediaActor) {
  const current = await db.mediaUser.findUnique({ where: { id: actor.id } });
  if (current?.plexAccountId !== actor.plexAccountId)
    throw new MediaError("unauthenticated", "Sign in again", 401);
  return current;
}

/**
 * Quality profiles are operator configuration: their rules name the release
 * groups, sizes and scores a download is chosen by. An owner reads them all.
 * Anyone else keeps a successful, empty read rather than a refusal, because
 * the title page of the previous client still asks for the list.
 */
export async function readQualityProfiles(
  db: Database,
  actor: MediaActor,
): Promise<ProfileList> {
  const current = await currentUser(db, actor);
  return current.role === "owner"
    ? ProfileListSchema.parse(
        await db.qualityProfile.findMany({ orderBy: { name: "asc" } }),
      )
    : [];
}

/** Only the owner's administration page reads the defaults, so anyone else is refused. */
export async function readProfileDefaults(
  db: Database,
  actor: MediaActor,
): Promise<ProfileDefaults> {
  requireOwner(await currentUser(db, actor));
  return ProfileDefaultsSchema.parse(
    await db.qualityProfileDefault.findMany({ orderBy: { kind: "asc" } }),
  );
}
