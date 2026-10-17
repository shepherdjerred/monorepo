import type { AuthStore, MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import type { Database } from "./database.ts";

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
}
