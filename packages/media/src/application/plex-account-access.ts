import { z } from "zod";
import type { AuthStore, MediaActor, PlexAuthentication } from "./auth.ts";
import type { CredentialCipher } from "./security.ts";
import type {
  PlexPermissionSnapshot,
  PlexServerAccess,
} from "./plex-access.ts";
import { MediaError } from "./errors.ts";

export function permissionSnapshot(
  access: PlexServerAccess,
): PlexPermissionSnapshot {
  const { serverToken: _token, ...snapshot } = access;
  return snapshot;
}

/** Reuse the registered device and exact account; this never creates a session or requester. */
export async function refreshPlexAccountAccess(
  input: { actor: MediaActor; encryptedCredential: string },
  ports: {
    store: Pick<AuthStore, "updateAccess" | "updateCredential">;
    plex: Pick<PlexAuthentication, "resolveServerAccess" | "refresh">;
    cipher: CredentialCipher;
    assertActive: () => void;
  },
): Promise<MediaActor | null> {
  const credential = z
    .object({
      token: z.string(),
      serverToken: z.string(),
      deviceState: z.string(),
    })
    .parse(
      JSON.parse(
        ports.cipher.decrypt(
          input.encryptedCredential,
          `plex:${input.actor.plexAccountId}`,
        ),
      ),
    );
  let access: PlexServerAccess | null;
  let refreshed = false;
  ports.assertActive();
  try {
    access = await ports.plex.resolveServerAccess(credential.token);
  } catch (error) {
    if (!(error instanceof MediaError) || error.code !== "plex_token_expired")
      throw error;
    ports.assertActive();
    credential.token = await ports.plex.refresh(credential.deviceState);
    refreshed = true;
    ports.assertActive();
    access = await ports.plex.resolveServerAccess(credential.token);
  }
  ports.assertActive();
  if (access?.accountId !== input.actor.plexAccountId) return null;
  const actor = await ports.store.updateAccess(
    input.actor.id,
    permissionSnapshot(access),
  );
  ports.assertActive();
  if (refreshed || credential.serverToken !== access.serverToken) {
    credential.serverToken = access.serverToken;
    await ports.store.updateCredential(
      input.actor.id,
      ports.cipher.encrypt(
        JSON.stringify(credential),
        `plex:${input.actor.plexAccountId}`,
      ),
      input.encryptedCredential,
    );
  }
  ports.assertActive();
  return actor;
}
