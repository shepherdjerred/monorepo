import { z } from "zod";
import { StatusSchema, sha256 } from "./model";

export function assertOfflinePending(
  value: unknown,
  profileID: string,
  vaultID: string,
  snapshot: unknown,
) {
  const profile = StatusSchema.shape.profiles.element.parse(value);
  const outbox = z
    .strictObject({ count: z.number().int().positive(), sha256 })
    .parse(snapshot);
  if (
    profile.profileID !== profileID ||
    profile.profileKind !== "obsidian_sync" ||
    profile.remoteVaultID !== vaultID ||
    profile.durable?.profileId !== profileID ||
    profile.durable.profileKind !== "obsidian_sync"
  )
    throw new Error("Offline proof does not belong to the bound profile");
  if (
    profile.phase !== "offline" ||
    profile.transport !== "offline" ||
    profile.durable.pendingUploadCount < 1 ||
    profile.durable.pendingUploadCount !== outbox.count
  )
    throw new Error(
      "Offline edits have no matching disconnected durable outbox",
    );
  return outbox;
}

export function assertUnchangedOfflineOutbox(
  before: ReturnType<typeof assertOfflinePending>,
  after: ReturnType<typeof assertOfflinePending>,
): void {
  if (before.count !== after.count || before.sha256 !== after.sha256)
    throw new Error("Offline proof changed before transport resumed");
}
