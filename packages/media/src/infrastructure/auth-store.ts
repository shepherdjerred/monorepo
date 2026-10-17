import type { AuthStore, MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import type { Database } from "./database.ts";
import type { PlexPermissionSnapshot } from "#application/plex-access.ts";
import type { Prisma } from "#generated/prisma/client.ts";

function publicActor(user: MediaActor): MediaActor {
  return {
    id: user.id,
    plexAccountId: user.plexAccountId,
    displayName: user.displayName,
    role: user.role,
    restricted: user.restricted,
    version: user.version,
  };
}

export class PrismaAuthStore implements AuthStore {
  constructor(private readonly database: Database) {}

  async saveLogin(input: Parameters<AuthStore["saveLogin"]>[0]): Promise<void> {
    await this.database.plexLogin.create({
      data: { ...input, pinId: String(input.pinId) },
    });
  }

  async getLogin(id: string) {
    const login = await this.database.plexLogin.findUnique({ where: { id } });
    if (!login) return null;
    const pinId = Number(login.pinId);
    if (!Number.isSafeInteger(pinId))
      throw new TypeError("Stored Plex PIN identifier is invalid");
    return { ...login, pinId };
  }

  completeLogin(input: Parameters<AuthStore["completeLogin"]>[0]) {
    return this.database.$transaction(async (db) => {
      const consumed = await db.plexLogin.deleteMany({
        where: { id: input.loginId, expiresAt: { gt: input.now } },
      });
      if (consumed.count !== 1)
        throw new MediaError(
          "login_consumed",
          "Login was already completed or expired",
          409,
        );
      const user = await db.mediaUser.upsert({
        where: { plexAccountId: input.accountId },
        create: {
          plexAccountId: input.accountId,
          displayName: input.displayName,
          role: input.accountId === input.ownerAccountId ? "owner" : "member",
        },
        update: {
          displayName: input.displayName,
          role: input.accountId === input.ownerAccountId ? "owner" : "member",
        },
      });
      await db.credential.upsert({
        where: { userId_kind: { userId: user.id, kind: "plex" } },
        create: {
          userId: user.id,
          kind: "plex",
          ciphertext: input.encryptedCredential,
        },
        update: { ciphertext: input.encryptedCredential },
      });
      await saveAccountAccess(db, user.id, input.access);
      await db.mediaSession.create({
        data: {
          id: input.sessionId,
          userId: user.id,
          csrfHash: input.csrfHash,
          expiresAt: input.expiresAt,
        },
      });
      return publicActor(user);
    });
  }

  async getSession(id: string, now: Date) {
    const session = await this.database.mediaSession.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!session || session.expiresAt <= now) return null;
    const credential = await this.database.credential.findUniqueOrThrow({
      where: { userId_kind: { userId: session.userId, kind: "plex" } },
    });
    return {
      actor: publicActor(session.user),
      csrfHash: session.csrfHash,
      encryptedCredential: credential.ciphertext,
    };
  }

  async updateCredential(
    userId: string,
    ciphertext: string,
    expectedCiphertext: string,
  ): Promise<boolean> {
    const result = await this.database.credential.updateMany({
      where: { userId, kind: "plex", ciphertext: expectedCiphertext },
      data: { ciphertext },
    });
    return result.count === 1;
  }

  async revokeSession(id: string): Promise<void> {
    await this.database.mediaSession.deleteMany({ where: { id } });
  }

  async updateAccess(
    userId: string,
    access: PlexPermissionSnapshot,
  ): Promise<void> {
    await this.database.$transaction(async (db) => {
      await saveAccountAccess(db, userId, access);
    });
  }
}

async function saveAccountAccess(
  db: Prisma.TransactionClient,
  userId: string,
  access: PlexPermissionSnapshot,
): Promise<void> {
  const user = await db.mediaUser.findUniqueOrThrow({ where: { id: userId } });
  if (user.plexAccountId !== access.accountId)
    throw new MediaError(
      "plex_identity_changed",
      "Plex account identity changed",
      403,
    );
  const prior = await db.plexIdentityMapping.findUnique({ where: { userId } });
  if (prior?.kind === "managed")
    throw new MediaError(
      "managed_profile_login",
      "Managed profiles cannot independently sign in",
      403,
    );
  const scope = {
    serverMachineId: access.serverMachineId,
    permittedSectionIds: access.permittedSectionIds,
    permittedMediaKinds: access.permittedMediaKinds,
    plexRestricted: access.plexRestricted,
    verifiedAt: new Date(),
  };
  const scopeChanged =
    prior?.serverMachineId !== access.serverMachineId ||
    prior.plexRestricted !== access.plexRestricted ||
    JSON.stringify([...prior.permittedSectionIds].sort()) !==
      JSON.stringify([...access.permittedSectionIds].sort()) ||
    JSON.stringify([...prior.permittedMediaKinds].sort()) !==
      JSON.stringify([...access.permittedMediaKinds].sort());
  await db.plexIdentityMapping.upsert({
    where: { userId },
    create: { userId, kind: "account", ...scope },
    update: {
      ...scope,
      ...(scopeChanged ? { version: { increment: 1 } } : {}),
      ...(prior?.serverMachineId === access.serverMachineId
        ? {}
        : { serverAccountId: null, homeUserId: null }),
    },
  });
}
