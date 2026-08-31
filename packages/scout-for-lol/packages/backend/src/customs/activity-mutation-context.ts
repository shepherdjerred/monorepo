import type {
  CustomActivityClaims,
  CustomNightSnapshot,
} from "@scout-for-lol/data";
import {
  customActivityActor,
  type CustomActivityActor,
} from "#src/customs/activity-actor.ts";
import {
  canManageCustomNight,
  customRoleFor,
} from "#src/customs/authorization.ts";
import { customSnapshotAfterMutation } from "#src/customs/after-mutation.ts";
import { buildCustomNightSnapshot } from "#src/customs/snapshot.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";

export type CustomRevisionInput = {
  readonly nightId: string;
  readonly expectedRevision: number;
};

export async function requiredCustomSnapshot(
  client: ExtendedPrismaClient,
  nightId: string,
  actor: CustomActivityActor,
  missingMessage = "Custom night does not exist",
): Promise<CustomNightSnapshot> {
  const snapshot = await buildCustomNightSnapshot(
    client,
    nightId,
    actor.discordId,
    { viewerAdministrator: actor.administrator },
  );
  if (snapshot === undefined) throw new Error(missingMessage);
  return snapshot;
}

export function assertCustomManager(
  snapshot: CustomNightSnapshot,
  actor: CustomActivityActor,
): void {
  const role = customRoleFor(snapshot, actor.discordId, actor.administrator);
  if (!canManageCustomNight(role)) {
    throw new Error("Only the host or a cohost can manage this custom night");
  }
}

export async function customMutationContext(
  claims: CustomActivityClaims,
  input: CustomRevisionInput,
  requireManager: boolean,
): Promise<{ actor: CustomActivityActor; snapshot: CustomNightSnapshot }> {
  const actor = await customActivityActor(claims);
  const snapshot = await requiredCustomSnapshot(prisma, input.nightId, actor);
  if (snapshot.guildId !== actor.guildId) {
    throw new Error("Custom night belongs to a different guild");
  }
  if (snapshot.revision !== input.expectedRevision) {
    throw new Error("Custom night revision is stale");
  }
  if (requireManager) assertCustomManager(snapshot, actor);
  return { actor, snapshot };
}

export async function customSnapshotForActorAfterMutation(
  nightId: string,
  actor: CustomActivityActor,
): Promise<CustomNightSnapshot> {
  return customSnapshotAfterMutation(
    prisma,
    nightId,
    actor.discordId,
    actor.administrator,
  );
}
