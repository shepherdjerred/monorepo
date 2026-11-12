import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import { MediaError, requireOwner } from "#application/errors.ts";
import type { Database } from "#infrastructure/database.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import { canonicalReferences } from "#infrastructure/acquisition-identity/references.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  ExternalEditionIntentSchema,
  ExternalEditionResultSchema,
  type ExternalEditionReview,
  type ExternalEditionIntent,
  type ExternalEditionResult,
} from "./contract.ts";

type Media = {
  id: string;
  version: number;
  kind: string;
  title: string;
  tmdbId: number | null;
  externalIds: unknown;
  seasonNumber: number | null;
  episodeNumber: number | null;
  aliases: string[];
};
export type ExternalEditionStore = {
  media: (actor: MediaActor, mediaId: string) => Promise<Media>;
  read: (review: ExternalEditionReview) => Promise<{
    intent: ExternalEditionIntent;
    completion: ExternalEditionResult | null;
  } | null>;
  begin: (actor: MediaActor, intent: ExternalEditionIntent) => Promise<boolean>;
  authorized: (
    actor: MediaActor,
    review: ExternalEditionReview,
    work: (media: Media, assertActive: () => Promise<void>) => Promise<void>,
  ) => Promise<void>;
  complete: (
    actor: MediaActor,
    review: ExternalEditionReview,
    result: ExternalEditionResult,
  ) => Promise<void>;
};
const changed = () =>
  new MediaError(
    "external_edition_changed",
    "The reviewed external movie or owner changed",
    409,
  );
const key = (review: ExternalEditionReview) =>
  `external-plex-edition:${identityHash({ server: review.before.identity.serverMachineId, ratingKey: review.before.identity.ratingKey })}`;

/** One durable PMS item slot prevents concurrent commands and blind retry after a lost PUT response. */
export class PrismaExternalEditionStore implements ExternalEditionStore {
  constructor(private readonly db: Database) {}
  async media(actor: MediaActor, mediaId: string): Promise<Media> {
    return await this.db.$transaction((tx) =>
      this.authority(tx, actor, mediaId),
    );
  }
  async read(review: ExternalEditionReview) {
    const intent = await this.db.applicationEvent.findUnique({
      where: { dedupeKey: key(review) },
    });
    if (intent === null) return null;
    const completion = await this.db.applicationEvent.findUnique({
      where: { dedupeKey: `${key(review)}:complete` },
    });
    return {
      intent: ExternalEditionIntentSchema.parse(intent.payload),
      completion:
        completion === null
          ? null
          : ExternalEditionResultSchema.parse(completion.payload),
    };
  }
  async begin(actor: MediaActor, intent: ExternalEditionIntent) {
    return await this.db.$transaction(async (tx) => {
      await this.reviewAuthority(tx, actor, intent.review);
      const previous = await tx.applicationEvent.findUnique({
        where: { dedupeKey: key(intent.review) },
      });
      if (previous !== null) {
        if (identityHash(previous.payload) !== identityHash(intent))
          throw changed();
        return false;
      }
      await tx.applicationEvent.create({
        data: {
          dedupeKey: key(intent.review),
          actorId: actor.id,
          mediaId: intent.review.target.mediaId,
          kind: intent.kind,
          payload: z.record(z.string(), z.json()).parse(intent),
        },
      });
      return true;
    });
  }
  async authorized(
    actor: MediaActor,
    review: ExternalEditionReview,
    work: (media: Media, assertActive: () => Promise<void>) => Promise<void>,
  ) {
    const expiresAt = Date.now() + 30_000;
    await this.db.$transaction(
      async (tx) => {
        const media = await this.reviewAuthority(tx, actor, review);
        await work(media, async () => {
          // Prove this exact transaction still holds the owner/item locks after PMS awaits.
          await tx.$queryRaw`SELECT 1`;
          if (Date.now() >= expiresAt) throw changed();
        });
      },
      { timeout: 30_000, maxWait: 30_000 },
    );
  }
  async complete(
    actor: MediaActor,
    review: ExternalEditionReview,
    result: ExternalEditionResult,
  ) {
    await this.db.$transaction(async (tx) => {
      await this.reviewAuthority(tx, actor, review);
      const original = await tx.applicationEvent.findUniqueOrThrow({
        where: { dedupeKey: key(review) },
      });
      const intent = ExternalEditionIntentSchema.parse(original.payload);
      if (
        intent.operationId !== result.operationId ||
        intent.review.reviewHash !== review.reviewHash
      )
        throw changed();
      await tx.applicationEvent.upsert({
        where: { dedupeKey: `${key(review)}:complete` },
        create: {
          dedupeKey: `${key(review)}:complete`,
          actorId: actor.id,
          mediaId: review.target.mediaId,
          kind: "external_plex_edition_completion_v1",
          payload: z.record(z.string(), z.json()).parse(result),
        },
        update: {},
      });
    });
  }
  private async reviewAuthority(
    tx: Prisma.TransactionClient,
    actor: MediaActor,
    review: ExternalEditionReview,
  ) {
    const media = await this.authority(tx, actor, review.target.mediaId);
    if (
      media.version !== review.mediaVersion ||
      identityHash({
        rootMediaId: media.id,
        title: media.title,
        aliases: media.aliases,
      }) !== review.canonicalHash ||
      actor.id !== review.actorId ||
      actor.version !== review.actorVersion
    )
      throw changed();
    const collision = await tx.libraryAsset.findFirst({
      where: {
        owned: true,
        OR: [
          { path: review.target.canonicalPath },
          {
            coverage: {
              some: {
                mediaId: media.id,
                edition: review.target.edition,
                current: true,
              },
            },
          },
        ],
      },
      select: { id: true },
    });
    if (collision !== null) throw changed();
    return media;
  }
  private async authority(
    tx: Prisma.TransactionClient,
    actor: MediaActor,
    mediaId: string,
  ): Promise<Media> {
    requireOwner(actor);
    await tx.$queryRaw`SELECT id FROM "MediaUser" WHERE id=${actor.id} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "MediaItem" WHERE id=${mediaId} FOR UPDATE`;
    const user = await tx.mediaUser.findUniqueOrThrow({
      where: { id: actor.id },
    });
    if (
      user.role !== "owner" ||
      user.restricted ||
      actor.restricted ||
      user.version !== actor.version ||
      user.plexAccountId !== actor.plexAccountId
    )
      throw changed();
    const media = await tx.mediaItem.findUniqueOrThrow({
      where: { id: mediaId },
    });
    if (media.kind !== "movie") throw changed();
    return { ...media, aliases: canonicalReferences(media).aliases };
  }
}
