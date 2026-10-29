import { z } from "zod";
import type { MediaActor, PlexAuthentication } from "#application/auth.ts";
import { MediaError, requireOwner } from "#application/errors.ts";
import type { CredentialCipher } from "#application/security.ts";
import { PlexHomeClient } from "#integrations/plex-home.ts";
import { PlexClient } from "#integrations/plex.ts";
import {
  PlexProfilesSchema,
  type SavePlexProfile,
} from "#shared/plex-admin.ts";
import type { FetchTransport } from "#integrations/http.ts";
import { MediaCommandBase } from "./command-base.ts";
import type { Database } from "./database.ts";

const CredentialSchema = z.object({
  token: z.string().min(1),
  serverToken: z.string().min(1),
});

export class PrismaPlexAdministration extends MediaCommandBase {
  private readonly transport: FetchTransport;
  constructor(
    private readonly db: Database,
    private readonly cipher: CredentialCipher,
    private readonly plex: Pick<PlexAuthentication, "resolveServerAccess">,
    private readonly server: {
      serverUrl: string;
      serverMachineId: string;
      transport?: FetchTransport;
    },
  ) {
    super(db, { keepDays: 30 });
    this.transport = server.transport ?? fetch;
  }

  private async ownerClients(actor: MediaActor) {
    requireOwner(actor);
    const owner = await this.db.mediaUser.findUniqueOrThrow({
      where: { id: actor.id },
    });
    requireOwner(owner);
    const credentials = await this.credentials(owner.id, owner.plexAccountId);
    return {
      home: new PlexHomeClient(credentials.token, this.transport),
      server: new PlexClient(
        {
          baseUrl: this.server.serverUrl,
          token: credentials.serverToken,
          clientIdentifier: "media-home-profiles",
        },
        this.transport,
      ),
    };
  }

  private async credentials(userId: string, accountId: string) {
    const row = await this.db.credential.findUnique({
      where: { userId_kind: { userId, kind: "plex" } },
    });
    if (row === null)
      throw new MediaError(
        "plex_credentials_required",
        "Sign in or reconnect this Plex profile",
        409,
      );
    return CredentialSchema.parse(
      JSON.parse(this.cipher.decrypt(row.ciphertext, `plex:${accountId}`)),
    );
  }

  async profiles(actor: MediaActor) {
    const clients = await this.ownerClients(actor);
    const [homeUsers, serverAccounts, mappings] = await Promise.all([
      clients.home.users(),
      clients.server.accounts(),
      this.db.plexIdentityMapping.findMany({
        where: { serverMachineId: this.server.serverMachineId },
        include: { user: true },
        orderBy: { userId: "asc" },
      }),
    ]);
    return PlexProfilesSchema.parse({
      homeUsers,
      serverAccounts: serverAccounts.map((account) => ({
        id: String(account.id),
        name: account.name,
      })),
      mappings: mappings.map((mapping) => ({
        userId: mapping.userId,
        globalAccountId: mapping.user.plexAccountId,
        displayName: mapping.user.displayName,
        serverAccountId: mapping.serverAccountId,
        homeUserId: mapping.homeUserId,
        kind: mapping.kind,
        version: mapping.version,
        permittedSectionIds: mapping.permittedSectionIds,
        verifiedAt: mapping.verifiedAt?.toISOString() ?? null,
      })),
    });
  }

  async saveProfile(actor: MediaActor, key: string, input: SavePlexProfile) {
    const clients = await this.ownerClients(actor);
    const [home, accounts] = await Promise.all([
      clients.home.users(),
      clients.server.accounts(),
    ]);
    const selected = home.find((profile) => profile.id === input.homeUserId);
    if (
      selected === undefined ||
      !accounts.some((account) => String(account.id) === input.serverAccountId)
    )
      throw new MediaError(
        "plex_mapping_changed",
        "Select current Plex Home and server account IDs",
        409,
      );
    const existing = await this.db.mediaUser.findUnique({
      where: { plexAccountId: selected.id },
    });
    if (existing === null && !selected.restricted)
      throw new MediaError(
        "plex_login_required",
        "Independent Plex accounts must sign in before being mapped",
        409,
      );
    const credential = selected.restricted
      ? { token: await clients.home.switchUser(selected.id, input.pin) }
      : await this.credentials(existing?.id ?? "", selected.id);
    const access = await this.plex.resolveServerAccess(credential.token);
    if (
      access?.accountId !== selected.id ||
      access.serverMachineId !== this.server.serverMachineId
    )
      throw new MediaError(
        "plex_library_access_required",
        "This profile cannot access the permitted libraries",
        403,
      );
    const { pin: _pin, ...publicInput } = input;
    return await this.command(
      actor,
      key,
      {
        kind: "map_plex_profile",
        input: {
          ...publicInput,
          pinFingerprint: this.cipher.fingerprint(
            input.pin ?? "",
            "plex-home-pin",
          ),
        },
      },
      async (tx) => {
        const user = await tx.mediaUser.upsert({
          where: { plexAccountId: selected.id },
          create: {
            plexAccountId: selected.id,
            displayName: selected.title,
            role: "member",
          },
          update: {},
        });
        const prior = await tx.plexIdentityMapping.findUnique({
          where: { userId: user.id },
        });
        if ((prior?.version ?? null) !== input.expectedVersion)
          throw new MediaError(
            "version_conflict",
            "Profile mapping changed; refresh before saving",
            409,
          );
        const mapping = {
          serverMachineId: this.server.serverMachineId,
          serverAccountId: input.serverAccountId,
          homeUserId: selected.id,
          kind: selected.restricted ? "managed" : "account",
          permittedSectionIds: access.permittedSectionIds,
          permittedMediaKinds: access.permittedMediaKinds,
          plexRestricted: access.plexRestricted,
          verifiedAt: new Date(),
        };
        await tx.plexIdentityMapping.upsert({
          where: { userId: user.id },
          create: { userId: user.id, ...mapping },
          update: { ...mapping, version: { increment: 1 } },
        });
        if (selected.restricted)
          await tx.credential.upsert({
            where: { userId_kind: { userId: user.id, kind: "plex" } },
            create: {
              userId: user.id,
              kind: "plex",
              ciphertext: this.cipher.encrypt(
                JSON.stringify({
                  token: credential.token,
                  serverToken: access.serverToken,
                }),
                `plex:${selected.id}`,
              ),
            },
            update: {
              ciphertext: this.cipher.encrypt(
                JSON.stringify({
                  token: credential.token,
                  serverToken: access.serverToken,
                }),
                `plex:${selected.id}`,
              ),
            },
          });
        await tx.watchState.deleteMany({ where: { userId: user.id } });
        await tx.applicationEvent.create({
          data: {
            actorId: actor.id,
            kind: "plex_profile_mapped",
            payload: {
              userId: user.id,
              homeUserId: selected.id,
              serverAccountId: input.serverAccountId,
            },
          },
        });
        return { status: "completed", userId: user.id };
      },
    );
  }

  async refreshProfileAccess(actor: MediaActor, userId: string): Promise<void> {
    requireOwner(actor);
    const user = await this.db.mediaUser.findUniqueOrThrow({
      where: { id: userId },
    });
    const mapping = await this.db.plexIdentityMapping.findUnique({
      where: { userId },
    });
    if (
      mapping?.kind !== "managed" ||
      mapping.serverMachineId !== this.server.serverMachineId
    )
      throw new MediaError(
        "managed_profile_required",
        "Select a mapped managed Plex profile",
        403,
      );
    const credential = await this.credentials(userId, user.plexAccountId);
    const access = await this.plex.resolveServerAccess(credential.token);
    if (
      access?.accountId !== user.plexAccountId ||
      access.serverMachineId !== this.server.serverMachineId
    ) {
      await this.db.plexIdentityMapping.updateMany({
        where: { userId, version: mapping.version },
        data: {
          permittedSectionIds: [],
          permittedMediaKinds: [],
          verifiedAt: null,
          version: { increment: 1 },
        },
      });
      throw new MediaError(
        "plex_profile_reconnect",
        "Reconnect this profile in Plex administration",
        403,
      );
    }
    await this.db.$transaction(async (tx) => {
      const changed = await tx.plexIdentityMapping.updateMany({
        where: { userId, version: mapping.version },
        data: {
          permittedSectionIds: access.permittedSectionIds,
          permittedMediaKinds: access.permittedMediaKinds,
          plexRestricted: access.plexRestricted,
          verifiedAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw new MediaError(
          "version_conflict",
          "Profile mapping changed; refresh first",
          409,
        );
      await tx.credential.update({
        where: { userId_kind: { userId, kind: "plex" } },
        data: {
          ciphertext: this.cipher.encrypt(
            JSON.stringify({ ...credential, serverToken: access.serverToken }),
            `plex:${user.plexAccountId}`,
          ),
        },
      });
    });
  }
}
