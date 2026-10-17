import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaActor } from "#application/auth.ts";
import { authorizeRequester } from "#infrastructure/requester-authorization.ts";
import {
  isRecoveryScopeV2,
  respondentMediaIds,
  type RecoveryScope,
} from "#shared/recovery.ts";
import { MediaError } from "#application/errors.ts";

export async function assertRecoveryRespondent(
  db: Prisma.TransactionClient,
  input: {
    scope: RecoveryScope;
    machineId: string;
    actor: MediaActor;
    subjectUserId: string;
  },
) {
  const { scope, actor, subjectUserId, machineId } = input;
  const expected = scope.users.find((user) => user.id === subjectUserId);
  const mapping = await db.plexIdentityMapping.findUnique({
    where: { userId: subjectUserId },
  });
  const ids = respondentMediaIds(scope, subjectUserId);
  const proxy = subjectUserId !== actor.id;
  if (
    expected === undefined ||
    mapping === null ||
    ids.length === 0 ||
    (proxy
      ? !isRecoveryScopeV2(scope) ||
        mapping.kind !== "managed" ||
        mapping.homeUserId === null
      : mapping.kind !== "account" ||
        mapping.homeUserId !== null ||
        mapping.plexRestricted)
  ) {
    throw new MediaError(
      "recovery_respondent_forbidden",
      "Independent accounts must respond themselves; only an exact managed identity permits an owner declaration",
      403,
    );
  }
  let currentActor: MediaActor | undefined;
  for (const mediaId of ids) {
    const media = scope.media.find((item) => item.id === mediaId);
    if (
      media?.sectionId === undefined ||
      media.sectionId === null ||
      (media.kind !== "movie" && media.kind !== "episode")
    )
      throw new MediaError(
        "recovery_scope_protected",
        "Refresh exact library identity and prepare a new review",
        409,
      );
    currentActor = await authorizeRequester(db, actor, subjectUserId, {
      kind: media.kind,
      serverMachineId: machineId,
      sectionId: media.sectionId,
    });
  }
  if (currentActor === undefined)
    throw new Error("Respondent has no applicable reviewed media");
  return {
    mode: proxy ? ("managed_owner" as const) : ("self" as const),
    actorId: currentActor.id,
    actorVersion: currentActor.version,
    subjectUserId,
    mappingVersion: mapping.version,
  };
}
