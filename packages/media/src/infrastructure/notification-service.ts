import { Prisma } from "#generated/prisma/client.ts";
import type { MediaActor } from "#application/auth.ts";
import type {
  DiscordIdentityProvider,
  NotificationApplication,
} from "#application/notification-ports.ts";
import { MediaError } from "#application/errors.ts";
import type { CredentialCipher } from "#application/security.ts";
import { randomToken, tokenHash } from "#application/security.ts";
import {
  NotificationPreferencesSchema,
  type UpdateNotificationPreferences,
  type CommandResult,
} from "#shared/api.ts";
import { PrismaMediaCommands } from "./commands.ts";
import type { Database } from "./database.ts";

export class PrismaNotificationApplication
  extends PrismaMediaCommands
  implements NotificationApplication
{
  constructor(
    private readonly db: Database,
    private readonly cipher: CredentialCipher,
    private readonly discord: DiscordIdentityProvider | null,
  ) {
    super(db, { keepDays: 30 });
  }

  async preferences(actor: MediaActor) {
    const user = await this.db.mediaUser.findUniqueOrThrow({
      where: { id: actor.id },
      include: { notificationPreference: true },
    });
    return NotificationPreferencesSchema.parse({
      email: user.email,
      emailVerified: user.emailVerifiedAt !== null,
      discordLinked: user.discordId !== null,
      emailEnabled: false,
      discordEnabled: false,
      upgrades: false,
      removalCompleted: false,
      version: 0,
      ...user.notificationPreference,
    });
  }

  updatePreferences(
    actor: MediaActor,
    key: string,
    input: UpdateNotificationPreferences,
  ) {
    return this.command(
      actor,
      key,
      { kind: "notification_preferences", input },
      async (db) => {
        const user = await db.mediaUser.findUniqueOrThrow({
          where: { id: actor.id },
        });
        if (input.emailEnabled && user.emailVerifiedAt === null)
          throw new MediaError(
            "email_not_verified",
            "Verify an email address before enabling email notifications",
            422,
          );
        if (input.discordEnabled && user.discordId === null)
          throw new MediaError(
            "discord_not_linked",
            "Link a Discord account before enabling Discord messages",
            422,
          );
        const previous = await db.notificationPreference.findUnique({
          where: { userId: actor.id },
        });
        if ((previous?.version ?? 0) !== input.expectedVersion)
          throw new MediaError(
            "version_conflict",
            "Preferences changed; refresh first",
            409,
          );
        const data = {
          emailEnabled: input.emailEnabled,
          discordEnabled: input.discordEnabled,
          upgrades: input.upgrades,
          removalCompleted: input.removalCompleted,
          version: input.expectedVersion + 1,
        };
        await db.notificationPreference.upsert({
          where: { userId: actor.id },
          create: { userId: actor.id, ...data },
          update: data,
        });
        return { status: "completed", version: data.version };
      },
    );
  }

  requestEmailVerification(actor: MediaActor, key: string, email: string) {
    return this.command(
      actor,
      key,
      { kind: "verify_email", input: { email } },
      async (db) => {
        const recent = await db.emailVerification.findFirst({
          where: {
            userId: actor.id,
            createdAt: { gt: new Date(Date.now() - 60_000) },
          },
        });
        if (recent !== null)
          throw new MediaError(
            "verification_rate_limited",
            "Wait one minute before requesting another verification email",
            429,
          );
        await db.emailVerification.deleteMany({ where: { userId: actor.id } });
        const id = crypto.randomUUID();
        const token = randomToken();
        await db.emailVerification.create({
          data: {
            id,
            userId: actor.id,
            email,
            tokenHash: tokenHash(token),
            encryptedToken: this.cipher.encrypt(token, `email:${id}`),
            expiresAt: new Date(Date.now() + 3_600_000),
          },
        });
        const event = await db.applicationEvent.create({
          data: {
            actorId: actor.id,
            kind: "email_verification",
            payload: { verificationId: id },
          },
        });
        const delivery = await db.notificationDelivery.create({
          data: {
            userId: actor.id,
            eventId: event.id,
            channel: "email",
            state: "pending",
          },
        });
        const operationId = crypto.randomUUID();
        const payload = {
          operationId,
          kind: "deliver_notification",
          notificationId: delivery.id,
        };
        await db.operation.create({
          data: {
            id: operationId,
            userId: actor.id,
            kind: "deliver_notification",
            payload,
            outbox: { create: { kind: "deliver_notification", payload } },
          },
        });
        return { operationId, status: "queued" };
      },
    );
  }

  async verifyEmail(actor: MediaActor, token: string): Promise<CommandResult> {
    return this.db.$transaction(async (db) => {
      const pending = await db.emailVerification.findUnique({
        where: { tokenHash: tokenHash(token) },
      });
      if (pending?.userId !== actor.id || pending.expiresAt <= new Date())
        throw new MediaError(
          "verification_invalid",
          "Email verification is expired or belongs to another user",
          422,
        );
      const consumed = await db.emailVerification.deleteMany({
        where: { id: pending.id, userId: actor.id },
      });
      if (consumed.count !== 1)
        throw new MediaError(
          "verification_consumed",
          "Email verification was already used",
          409,
        );
      await db.mediaUser.update({
        where: { id: actor.id },
        data: {
          email: pending.email,
          emailVerifiedAt: new Date(),
          version: { increment: 1 },
        },
      });
      return { status: "completed" } satisfies CommandResult;
    });
  }

  async startDiscordLink(actor: MediaActor) {
    if (this.discord === null)
      throw new MediaError(
        "discord_not_configured",
        "Discord account linking is not configured",
        503,
      );
    const state = randomToken();
    await this.db.discordLink.create({
      data: {
        userId: actor.id,
        stateHash: tokenHash(state),
        expiresAt: new Date(Date.now() + 600_000),
      },
    });
    return { authorizationUrl: this.discord.authorizationUrl(state) };
  }

  async completeDiscordLink(
    actor: MediaActor,
    input: { code: string; state: string; issuer: string },
  ): Promise<CommandResult> {
    if (this.discord === null)
      throw new MediaError(
        "discord_not_configured",
        "Discord account linking is not configured",
        503,
      );
    if (input.issuer !== "https://discord.com")
      throw new MediaError(
        "discord_issuer_invalid",
        "Discord authorization issuer does not match",
        422,
      );
    const pending = await this.db.discordLink.findUnique({
      where: { stateHash: tokenHash(input.state) },
    });
    if (pending?.userId !== actor.id || pending.expiresAt <= new Date())
      throw new MediaError(
        "discord_state_invalid",
        "Discord authorization expired or belongs to another account",
        422,
      );
    const identity = await this.discord.exchangeCode(input.code);
    try {
      return await this.db.$transaction(async (db) => {
        const consumed = await db.discordLink.deleteMany({
          where: {
            id: pending.id,
            userId: actor.id,
            expiresAt: { gt: new Date() },
          },
        });
        if (consumed.count !== 1)
          throw new MediaError(
            "discord_state_consumed",
            "Discord authorization was already completed",
            409,
          );
        await db.mediaUser.update({
          where: { id: actor.id },
          data: { discordId: identity.id, version: { increment: 1 } },
        });
        return { status: "completed" } satisfies CommandResult;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new MediaError(
          "discord_already_linked",
          "This Discord account is already linked to another media user",
          409,
        );
      throw error;
    }
  }

  async unlinkDiscord(actor: MediaActor): Promise<CommandResult> {
    await this.db.$transaction(async (db) => {
      await db.mediaUser.update({
        where: { id: actor.id },
        data: { discordId: null, version: { increment: 1 } },
      });
      await db.notificationPreference.updateMany({
        where: { userId: actor.id },
        data: { discordEnabled: false, version: { increment: 1 } },
      });
      await db.discordLink.deleteMany({ where: { userId: actor.id } });
    });
    return { status: "completed" };
  }
}
