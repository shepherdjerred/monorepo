import type { PlexAuthentication } from "#application/auth.ts";
import type { CredentialCipher } from "#application/security.ts";
import { MediaError } from "#application/errors.ts";
import { refreshPlexAccountAccess } from "#application/plex-account-access.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { PrismaAuthStore } from "#infrastructure/auth-store.ts";
import type { Database } from "#infrastructure/database.ts";
import { PrismaPlexAdministration } from "#infrastructure/plex-admin.ts";
import { REQUESTER_ACCESS_MAX_AGE_MS } from "#infrastructure/requester-authorization.ts";
import {
  plexBindingFreshness,
  bindPlexTransactionDeadline,
} from "#infrastructure/plex-binding/freshness.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";

type Sponsor = { userId: string; actorId: string };
type RefreshPorts = {
  db: Database;
  cipher: CredentialCipher;
  loadPlex: (
    execution: PlexBindingExecution,
  ) => Promise<Pick<PlexAuthentication, "resolveServerAccess" | "refresh">>;
  server: { serverUrl: string; serverMachineId: string };
};

function fresh(verifiedAt: Date | null): boolean {
  const verified = verifiedAt?.getTime();
  const now = Date.now();
  return (
    verified !== undefined &&
    verified <= now &&
    now - verified <= REQUESTER_ACCESS_MAX_AGE_MS
  );
}

/** Renew the exact existing sponsor principals; no session or new profile grant is created. */
export function requesterAccessRefresher(
  db: Database,
  cipher: CredentialCipher,
  loadPlex: (
    execution: PlexBindingExecution,
  ) => Promise<Pick<PlexAuthentication, "resolveServerAccess" | "refresh">>,
  server: { serverUrl: string; serverMachineId: string },
) {
  return async (
    sponsors: readonly Sponsor[],
    execution: PlexBindingExecution,
    budget: PublicationAuthorityReadBudget,
  ): Promise<void> => {
    const freshness = plexBindingFreshness({
      observed: execution.observed,
      expiresAtMs: execution.expiresAtMs,
      guards: [execution],
    });
    const store = new PrismaAuthStore(db, freshness);
    const actors = [
      ...new Set(sponsors.map((sponsor) => sponsor.actorId)),
    ].sort();
    for (const userId of actors) {
      execution.assertActive();
      const user = await db.mediaUser.findUniqueOrThrow({
        where: { id: userId },
        include: { plexIdentity: true },
      });
      const mapping = user.plexIdentity;
      budget.consume(mapping === null ? 1 : 2);
      if (user.restricted || mapping?.kind !== "account") continue;
      if (fresh(mapping.verifiedAt)) continue;
      const credential = await db.credential.findUnique({
        where: { userId_kind: { userId, kind: "plex" } },
      });
      budget.consume(credential === null ? 0 : 1);
      if (credential === null)
        throw new MediaError(
          "plex_credentials_required",
          "Reconnect this Plex account",
          409,
        );
      // The shared store rereads the account and mapping under its write lock.
      budget.consume(3);
      const actor = await refreshPlexAccountAccess(
        { actor: user, encryptedCredential: credential.ciphertext },
        {
          store,
          cipher,
          plex: await loadPlex(execution),
          assertActive: freshness.assertActive,
        },
      );
      execution.assertActive();
      if (actor !== null) continue;
      await db.$transaction(async (tx) => {
        await bindPlexTransactionDeadline(tx, freshness);
        await tx.plexIdentityMapping.updateMany({
          where: {
            userId,
            kind: "account",
            version: mapping.version,
            verifiedAt: mapping.verifiedAt,
          },
          data: { verifiedAt: null, version: { increment: 1 } },
        });
        freshness.assertActive();
      });
      throw new MediaError(
        "plex_library_access_required",
        "This account no longer has the configured Plex library access",
        403,
      );
    }
    await refreshManagedProfiles({ db, cipher, loadPlex, server }, sponsors, {
      execution,
      budget,
      freshness,
    });
  };
}

async function refreshManagedProfiles(
  ports: RefreshPorts,
  sponsors: readonly Sponsor[],
  invocation: {
    execution: PlexBindingExecution;
    budget: PublicationAuthorityReadBudget;
    freshness: PlexBindingFreshness;
  },
) {
  const { db, cipher, loadPlex, server } = ports;
  const { execution, budget, freshness } = invocation;
  for (const sponsor of sponsors) {
    if (sponsor.userId === sponsor.actorId) continue;
    execution.assertActive();
    const mapping = await db.plexIdentityMapping.findUnique({
      where: { userId: sponsor.userId },
    });
    budget.consume(mapping === null ? 0 : 1);
    if (mapping?.kind !== "managed") continue;
    if (fresh(mapping.verifiedAt)) continue;
    const actor = await db.mediaUser.findUniqueOrThrow({
      where: { id: sponsor.actorId },
    });
    budget.consume(1);
    if (actor.restricted)
      throw new MediaError(
        "requests_restricted",
        "This owner cannot authorize profile work",
        403,
      );
    budget.consume(3);
    execution.assertActive();
    await new PrismaPlexAdministration(
      db,
      cipher,
      await loadPlex(execution),
      server,
    ).refreshProfileAccess(actor, sponsor.userId, freshness);
    execution.assertActive();
  }
}
